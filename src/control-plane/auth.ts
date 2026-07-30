import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { SecretBox } from "../integrations/secrets";
import type {
  AuthSessionRecord,
  ControlPlaneStore,
  ReviewerAuthorization,
  ReviewerIdentity,
} from "./types";

const SESSION_COOKIE = "software_oath_session";
const STATE_COOKIE = "software_oath_oauth_state";

function cookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((entry) => entry.trim().split("="))
      .filter(([key, value]) => Boolean(key && value))
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function cookie(
  name: string,
  value: string,
  options: { maxAge?: number; secure: boolean },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    options.secure ? "Secure" : "",
    options.maxAge === undefined ? "" : `Max-Age=${options.maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function encodeState(value: object, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function decodeState(
  value: string,
  secret: string,
): { nonce: string; expiresAt: string } {
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) throw new Error("OAuth state is invalid.");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("OAuth state signature is invalid.");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    nonce: string;
    expiresAt: string;
  };
  if (parsed.expiresAt <= new Date().toISOString()) {
    throw new Error("OAuth state has expired.");
  }
  return parsed;
}

export class GitHubReviewerOAuth {
  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      publicUrl: string;
      fetch?: typeof fetch;
    },
  ) {}

  authorizationUrl(state: string): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set(
      "redirect_uri",
      `${this.options.publicUrl.replace(/\/$/, "")}/api/auth/github/callback`,
    );
    url.searchParams.set("scope", "read:user repo");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchange(code: string): Promise<string> {
    const response = await (this.options.fetch ?? fetch)(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          code,
        }),
      },
    );
    const result = (await response.json()) as {
      access_token?: string;
      error_description?: string;
    };
    if (!response.ok || !result.access_token) {
      throw new Error(result.error_description ?? "GitHub OAuth exchange failed.");
    }
    return result.access_token;
  }

  private async github<T>(path: string, token: string): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(
      `https://api.github.com${path}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub authorization check failed with ${response.status}.`);
    }
    return (await response.json()) as T;
  }

  async identity(token: string): Promise<ReviewerIdentity> {
    const user = await this.github<{
      id: number;
      login: string;
      name?: string;
      avatar_url?: string;
    }>("/user", token);
    return {
      provider: "github",
      providerUserId: String(user.id),
      login: user.login,
      displayName: user.name || undefined,
      avatarUrl: user.avatar_url || undefined,
    };
  }

  async authorize(
    token: string,
    repository: string,
    now = new Date(),
  ): Promise<ReviewerAuthorization> {
    const repo = await this.github<{
      permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
    }>(`/repos/${repository.split("/").map(encodeURIComponent).join("/")}`, token);
    const permission = repo.permissions?.admin
      ? "admin"
      : repo.permissions?.maintain
        ? "maintain"
        : repo.permissions?.push
          ? "push"
          : undefined;
    if (!permission) {
      throw new Error(`GitHub user lacks write permission for ${repository}.`);
    }
    return { repository, permission, verifiedAt: now.toISOString() };
  }
}

export class ReviewerSessions {
  private readonly box: SecretBox;
  private readonly secure: boolean;

  constructor(
    private readonly options: {
      store: ControlPlaneStore;
      masterKey: string;
      stateSecret: string;
      publicUrl: string;
      ttlMs?: number;
    },
  ) {
    this.box = new SecretBox(options.masterKey);
    this.secure = new URL(options.publicUrl).protocol === "https:";
  }

  begin(response: ServerResponse): { state: string; nonce: string } {
    const nonce = randomBytes(24).toString("base64url");
    const state = encodeState(
      {
        nonce,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      this.options.stateSecret,
    );
    response.setHeader(
      "Set-Cookie",
      cookie(STATE_COOKIE, state, { maxAge: 600, secure: this.secure }),
    );
    return { state, nonce };
  }

  verifyCallback(request: IncomingMessage, state: string): void {
    const stored = cookies(request)[STATE_COOKIE];
    if (!stored || stored !== state) throw new Error("OAuth state cookie mismatch.");
    decodeState(state, this.options.stateSecret);
  }

  async create(
    response: ServerResponse,
    identity: ReviewerIdentity,
    accessToken: string,
    now = new Date(),
  ): Promise<AuthSessionRecord> {
    const ttlMs = this.options.ttlMs ?? 8 * 60 * 60_000;
    const session: AuthSessionRecord = {
      id: randomUUID(),
      identity,
      encryptedAccessToken: this.box.encrypt(accessToken),
      csrfToken: randomBytes(24).toString("base64url"),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    await this.options.store.saveAuthSession(session);
    response.setHeader("Set-Cookie", [
      cookie(SESSION_COOKIE, session.id, {
        maxAge: Math.floor(ttlMs / 1000),
        secure: this.secure,
      }),
      cookie(STATE_COOKIE, "", { maxAge: 0, secure: this.secure }),
    ]);
    return session;
  }

  async authenticate(request: IncomingMessage): Promise<{
    session: AuthSessionRecord;
    accessToken: string;
  } | undefined> {
    const id = cookies(request)[SESSION_COOKIE];
    if (!id) return undefined;
    const session = await this.options.store.getAuthSession(id);
    if (!session || session.expiresAt <= new Date().toISOString()) {
      if (session) await this.options.store.deleteAuthSession(id);
      return undefined;
    }
    return { session, accessToken: this.box.decrypt(session.encryptedAccessToken) };
  }

  assertCsrf(request: IncomingMessage, session: AuthSessionRecord): void {
    if (request.headers["x-csrf-token"] !== session.csrfToken) {
      throw new Error("CSRF validation failed.");
    }
  }

  async logout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = cookies(request)[SESSION_COOKIE];
    if (id) await this.options.store.deleteAuthSession(id);
    response.setHeader(
      "Set-Cookie",
      cookie(SESSION_COOKIE, "", { maxAge: 0, secure: this.secure }),
    );
  }
}

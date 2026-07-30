import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubReviewerOAuth, ReviewerSessions } from "./auth";
import { FileControlPlaneStore } from "./store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function responseFixture() {
  const headers = new Map<string, string | string[]>();
  return {
    headers,
    response: {
      setHeader(name: string, value: string | string[]) {
        headers.set(name, value);
      },
    } as ServerResponse,
  };
}

describe("GitHub reviewer authentication", () => {
  it("derives immutable identity and repository permission from GitHub", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 42, login: "reviewer", name: "Review Person" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ permissions: { maintain: true } }), {
          status: 200,
        }),
      );
    const oauth = new GitHubReviewerOAuth({
      clientId: "client",
      clientSecret: "secret",
      publicUrl: "https://oath.example.com",
      fetch,
    });

    const token = await oauth.exchange("code");
    expect(await oauth.identity(token)).toMatchObject({
      providerUserId: "42",
      login: "reviewer",
    });
    expect(await oauth.authorize(token, "owner/repo")).toMatchObject({
      repository: "owner/repo",
      permission: "maintain",
    });
  });

  it("rejects users without repository write permission", async () => {
    const oauth = new GitHubReviewerOAuth({
      clientId: "client",
      clientSecret: "secret",
      publicUrl: "https://oath.example.com",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ permissions: { pull: true } }), {
          status: 200,
        }),
      ),
    });

    await expect(oauth.authorize("token", "owner/repo")).rejects.toThrow(
      "lacks write permission",
    );
  });

  it("uses opaque encrypted sessions and enforces CSRF", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-auth-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const sessions = new ReviewerSessions({
      store,
      masterKey: randomBytes(32).toString("base64"),
      stateSecret: "state-secret",
      publicUrl: "https://oath.example.com",
    });
    const { response, headers } = responseFixture();
    const session = await sessions.create(
      response,
      { provider: "github", providerUserId: "42", login: "reviewer" },
      "github-access-token",
      new Date("2026-07-30T12:00:00Z"),
    );
    const setCookies = headers.get("Set-Cookie") as string[];
    const sessionCookie = setCookies[0].split(";")[0];
    expect(sessionCookie).not.toContain("github-access-token");
    expect(session.encryptedAccessToken).not.toContain("github-access-token");

    const request = {
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": session.csrfToken,
      },
    } as IncomingMessage;
    const authenticated = await sessions.authenticate(request);
    expect(authenticated?.accessToken).toBe("github-access-token");
    expect(() => sessions.assertCsrf(request, session)).not.toThrow();
    expect(() =>
      sessions.assertCsrf(
        { headers: { cookie: sessionCookie } } as IncomingMessage,
        session,
      ),
    ).toThrow("CSRF");
  });
});

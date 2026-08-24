import { createSign } from "node:crypto";

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createGitHubAppJwt(options: {
  appId: string;
  privateKey: string;
  now?: Date;
}): string {
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: options.appId,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(options.privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

export class GitHubAppClient {
  constructor(
    private readonly options: {
      appId: string;
      privateKey: string;
      apiUrl?: string;
      fetch?: typeof fetch;
    },
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit,
    token: string,
  ): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.apiUrl ?? "https://api.github.com"}${path}`,
      {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `GitHub API ${response.status}: ${(await response.text()).slice(0, 500)}`,
      );
    }
    return (await response.json()) as T;
  }

  async installationToken(installationId: number): Promise<string> {
    const jwt = createGitHubAppJwt(this.options);
    const result = await this.request<{ token: string }>(
      `/app/installations/${installationId}/access_tokens`,
      { method: "POST" },
      jwt,
    );
    return result.token;
  }

  async installationUrl(): Promise<string> {
    const app = await this.request<{ slug: string }>(
      "/app",
      { method: "GET" },
      createGitHubAppJwt(this.options),
    );
    return `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`;
  }

  async installedRepositories(): Promise<Array<{
    installationId: number;
    repository: string;
  }>> {
    const jwt = createGitHubAppJwt(this.options);
    const installations = await this.request<Array<{ id: number }>>(
      "/app/installations?per_page=100",
      { method: "GET" },
      jwt,
    );
    const repositories = await Promise.all(
      installations.map(async ({ id }) => {
        const token = await this.installationToken(id);
        const response = await this.request<{
          repositories: Array<{ full_name: string }>;
        }>(
          "/installation/repositories?per_page=100",
          { method: "GET" },
          token,
        );
        return response.repositories.map(({ full_name }) => ({
          installationId: id,
          repository: full_name,
        }));
      }),
    );
    return repositories.flat();
  }

  async convertManifestCode(code: string): Promise<{
    id: number;
    slug: string;
    client_id: string;
    client_secret: string;
    webhook_secret: string;
    pem: string;
  }> {
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.apiUrl ?? "https://api.github.com"}/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub manifest conversion failed with ${response.status}.`);
    }
    return (await response.json()) as {
      id: number;
      slug: string;
      client_id: string;
      client_secret: string;
      webhook_secret: string;
      pem: string;
    };
  }

  async dispatchRepair(options: {
    installationId: number;
    owner: string;
    repo: string;
    repairId: string;
    receiptUrl: string;
  }): Promise<void> {
    const token = await this.installationToken(options.installationId);
    await this.request(
      `/repos/${options.owner}/${options.repo}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify({
          event_type: "software-oath-repair",
          client_payload: {
            repair_id: options.repairId,
            receipt_url: options.receiptUrl,
          },
        }),
      },
      token,
    );
  }

  async openRepairPullRequest(options: {
    installationId: number;
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number; html_url: string }> {
    const token = await this.installationToken(options.installationId);
    return await this.request(
      `/repos/${options.owner}/${options.repo}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: options.title,
          head: options.head,
          base: options.base,
          body: options.body,
          draft: true,
        }),
      },
      token,
    );
  }

  async checkCommit(options: {
    installationId: number;
    owner: string;
    repo: string;
    ref: string;
  }): Promise<{
    state: "pending" | "success" | "failure";
    total: number;
    failed: string[];
  }> {
    const token = await this.installationToken(options.installationId);
    const checks = await this.request<{
      total_count: number;
      check_runs: Array<{
        name: string;
        status: string;
        conclusion: string | null;
      }>;
    }>(
      `/repos/${options.owner}/${options.repo}/commits/${encodeURIComponent(options.ref)}/check-runs`,
      { method: "GET" },
      token,
    );
    const failed = checks.check_runs
      .filter(
        ({ status, conclusion }) =>
          status === "completed" &&
          !["success", "neutral", "skipped"].includes(conclusion ?? ""),
      )
      .map(({ name }) => name);
    const pending = checks.check_runs.some(({ status }) => status !== "completed");
    return {
      state: failed.length ? "failure" : pending || checks.total_count === 0 ? "pending" : "success",
      total: checks.total_count,
      failed,
    };
  }
}

export function githubAppManifest(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  return {
    name: "Software Oath",
    url: origin,
    hook_attributes: {
      url: `${origin}/webhooks/github`,
      active: true,
    },
    redirect_url: `${origin}/api/github/manifest/callback`,
    callback_urls: [`${origin}/api/github/callback`],
    public: false,
    default_permissions: {
      contents: "write",
      metadata: "read",
      pull_requests: "write",
    },
    default_events: ["installation", "installation_repositories", "push"],
  };
}

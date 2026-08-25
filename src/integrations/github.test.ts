import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  GitHubAppClient,
  createGitHubAppJwt,
  githubAppManifest,
} from "./github.js";

describe("GitHub App integration", () => {
  it("creates a short-lived RS256 app JWT", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = createGitHubAppJwt({
      appId: "123",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      now: new Date("2026-07-30T00:00:00Z"),
    });
    const [header, payload] = token
      .split(".")
      .slice(0, 2)
      .map((part) =>
        JSON.parse(Buffer.from(part, "base64url").toString("utf8")),
      );

    expect(header).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(payload).toMatchObject({ iss: "123" });
    expect(payload.exp - payload.iat).toBe(600);
  });

  it("uses an installation token to open a draft repair PR", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      return new Response(
        url.includes("access_tokens")
          ? JSON.stringify({ token: "installation-token" })
          : init?.method === "GET"
            ? JSON.stringify([])
          : JSON.stringify({ number: 7, html_url: "https://github.test/pr/7" }),
        { status: url.includes("access_tokens") || init?.method !== "GET" ? 201 : 200 },
      );
    };
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      apiUrl: "https://github.test",
      fetch: fakeFetch,
    });

    const pullRequest = await client.openRepairPullRequest({
      installationId: 99,
      owner: "acme",
      repo: "storefront",
      head: "software-oath/repair-1",
      base: "main",
      title: "Repair checkout",
      body: "Evidence receipt attached.",
    });

    expect(pullRequest.number).toBe(7);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://github.test/app/installations/99/access_tokens",
      "https://github.test/repos/acme/storefront/pulls?state=all&head=acme%3Asoftware-oath%2Frepair-1&base=main&per_page=1",
      "https://github.test/repos/acme/storefront/pulls",
    ]);
    expect(requests[2].init?.headers).toMatchObject({
      Authorization: "Bearer installation-token",
    });
    expect(JSON.parse(String(requests[2].init?.body))).toMatchObject({
      draft: true,
      head: "software-oath/repair-1",
    });
  });

  it("reuses the pull request for a deterministic repair branch", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
      }
      return new Response(JSON.stringify([
        { number: 7, html_url: "https://github.test/pr/7" },
      ]));
    };
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      apiUrl: "https://github.test",
      fetch: fakeFetch,
    });

    await expect(client.openRepairPullRequest({
      installationId: 99,
      owner: "acme",
      repo: "storefront",
      head: "software-oath/repair-1",
      base: "main",
      title: "Repair checkout",
      body: "Evidence receipt attached.",
    })).resolves.toEqual({ number: 7, html_url: "https://github.test/pr/7" });

    expect(requests).toHaveLength(2);
    expect(requests[1].init?.method).toBe("GET");
  });

  it("creates a branch, commits only the initial oath, and opens a draft PR", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
      }
      if (url.includes("/git/ref/heads/")) {
        return new Response(JSON.stringify({ object: { sha: "base-sha" } }));
      }
      if (url.endsWith("/contents/software-oath.yml?ref=main")) {
        return new Response(JSON.stringify({ sha: "existing-oath-sha" }));
      }
      if (url.endsWith("/contents/software-oath.yml")) {
        return new Response(JSON.stringify({ commit: { sha: "oath-sha" } }), { status: 201 });
      }
      if (url.endsWith("/pulls")) {
        return new Response(JSON.stringify({
          number: 8, html_url: "https://github.test/pr/8",
        }), { status: 201 });
      }
      return new Response(JSON.stringify({}), { status: 201 });
    };
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      apiUrl: "https://github.test",
      fetch: fakeFetch,
    });

    const proposal = await client.proposeInitialOath({
      installationId: 99, owner: "acme", repo: "storefront",
      branch: "software-oath/initial-oath-1", base: "main", source: "version: 1\n",
    });

    expect(proposal).toMatchObject({ number: 8, commit: "oath-sha" });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://github.test/app/installations/99/access_tokens",
      "https://github.test/repos/acme/storefront/git/ref/heads/main",
      "https://github.test/repos/acme/storefront/contents/software-oath.yml?ref=main",
      "https://github.test/repos/acme/storefront/git/refs",
      "https://github.test/repos/acme/storefront/contents/software-oath.yml",
      "https://github.test/repos/acme/storefront/pulls",
    ]);
    expect(JSON.parse(String(requests[3].init?.body))).toMatchObject({
      ref: "refs/heads/software-oath/initial-oath-1", sha: "base-sha",
    });
    expect(JSON.parse(String(requests[4].init?.body))).toMatchObject({
      content: Buffer.from("version: 1\n").toString("base64"),
      branch: "software-oath/initial-oath-1",
      sha: "existing-oath-sha",
    });
    expect(JSON.parse(String(requests[5].init?.body))).toMatchObject({ draft: true });
  });

  it("builds a private least-privilege app manifest", () => {
    expect(githubAppManifest("https://oath.example/setup")).toMatchObject({
      public: false,
      hook_attributes: { url: "https://oath.example/webhooks/github" },
      default_permissions: {
        contents: "write",
        metadata: "read",
        pull_requests: "write",
      },
    });
  });

  it("resolves the installation URL from the authenticated App identity", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ slug: "software-oath" }), { status: 200 }),
    );
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      apiUrl: "https://github.test",
      fetch,
    });

    await expect(client.installationUrl()).resolves.toBe(
      "https://github.com/apps/software-oath/installations/new",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://github.test/app",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("lists repositories for every GitHub App installation", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/app/installations?per_page=100")) {
        return new Response(JSON.stringify([{ id: 10 }, { id: 20 }]));
      }
      if (url.includes("access_tokens")) {
        return new Response(JSON.stringify({ token: `token-${url.includes("/10/") ? 10 : 20}` }));
      }
      const authorization = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
      );
      return new Response(JSON.stringify({
        repositories: [{ full_name: authorization.includes("token-10") ? "acme/one" : "acme/two" }],
      }));
    };
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      apiUrl: "https://github.test",
      fetch: fakeFetch,
    });

    await expect(client.installedRepositories()).resolves.toEqual([
      { installationId: 10, repository: "acme/one" },
      { installationId: 20, repository: "acme/two" },
    ]);
  });

  it("classifies pull-request checks before owner review", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      return new Response(
        url.includes("access_tokens")
          ? JSON.stringify({ token: "installation-token" })
          : JSON.stringify({
              total_count: 2,
              check_runs: [
                { name: "test", status: "completed", conclusion: "success" },
                { name: "lint", status: "completed", conclusion: "failure" },
              ],
            }),
        { status: 200 },
      );
    };
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      apiUrl: "https://github.test",
      fetch: fakeFetch,
    });

    expect(
      await client.checkCommit({
        installationId: 99,
        owner: "acme",
        repo: "storefront",
        ref: "software-oath/repair-1",
      }),
    ).toEqual({ state: "failure", total: 2, failed: ["lint"] });
  });
});

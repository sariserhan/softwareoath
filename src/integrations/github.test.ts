import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  GitHubAppClient,
  createGitHubAppJwt,
  githubAppManifest,
} from "./github";

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
          : JSON.stringify({ number: 7, html_url: "https://github.test/pr/7" }),
        { status: url.includes("access_tokens") ? 201 : 201 },
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
      "https://github.test/repos/acme/storefront/pulls",
    ]);
    expect(requests[1].init?.headers).toMatchObject({
      Authorization: "Bearer installation-token",
    });
    expect(JSON.parse(String(requests[1].init?.body))).toMatchObject({
      draft: true,
      head: "software-oath/repair-1",
    });
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

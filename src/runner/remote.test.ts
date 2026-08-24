import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteTrustedRunner } from "./remote";

afterEach(() => vi.unstubAllGlobals());

describe("RemoteTrustedRunner", () => {
  it("authenticates broker requests and selects the requested network policy", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ exitCode: 0, output: "ok", durationMs: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const runner = new RemoteTrustedRunner({
      baseUrl: "http://runner-broker:8790",
      token: "broker-secret",
      network: "bridge",
    });
    await expect(runner.execute({
      command: "npm ci",
      workspacePath: "/workspaces/job",
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ exitCode: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://runner-broker:8790/execute",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer broker-secret",
        }),
        body: expect.stringContaining('"network":"bridge"'),
      }),
    );
  });
});

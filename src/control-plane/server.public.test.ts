import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlPlaneServer } from "./server.js";
import { FileControlPlaneStore } from "./store.js";

const roots: string[] = [];
const servers: Array<ReturnType<typeof createControlPlaneServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public repository scan API", () => {
  it("registers and queues a public repository without owner authentication", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-public-api-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const dispatch = vi.fn(async () => undefined);
    const server = createControlPlaneServer({
      store,
      approvalToken: "operator",
      runDispatcher: { dispatch },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

    const queued = await fetch(origin + "/api/public/repositories/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/openai/openai-node" }),
    });
    expect(queued.status).toBe(202);
    const payload = await queued.json() as { repository: { repository: string; cloneUrl: string; defaultBranch: string; installationId?: number }; run: { id: string } };
    expect(payload.repository).toMatchObject({
      repository: "openai/openai-node",
      cloneUrl: "https://github.com/openai/openai-node.git",
      defaultBranch: "HEAD",
    });
    expect(payload.repository.installationId).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith(payload.run.id);

    const progress = await fetch(origin + "/api/public/runs/" + encodeURIComponent(payload.run.id));
    expect(progress.status).toBe(200);
    expect(await progress.json()).toMatchObject({
      run: { id: payload.run.id, repository: "openai/openai-node", status: "received" },
    });
  });

  it("does not let an anonymous scan replace an owner-connected repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-public-owner-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const now = new Date().toISOString();
    await store.upsertRepository({
      id: "REPOSITORY-1", repository: "openai/openai-node",
      cloneUrl: "https://github.com/openai/openai-node.git", defaultBranch: "main",
      installationId: 42, schedule: { mode: "weekly", timezone: "UTC" },
      policy: { maxPullRequestsPerRun: 1, maxCiRepairAttempts: 2, allowMajorPackageUpdates: false, automaticMerge: false },
      createdAt: now, updatedAt: now,
    });
    const server = createControlPlaneServer({ store, approvalToken: "operator" });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const response = await fetch(origin + "/api/public/repositories/scan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/openai/openai-node" }),
    });
    expect(response.status).toBe(409);
    expect((await store.getRepository("openai/openai-node"))?.installationId).toBe(42);
  });
});

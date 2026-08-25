import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileControlPlaneStore } from "./store.js";
import { operationalMetrics, structuredLog } from "./observability.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe("operational observability", () => {
  it("exports bounded metrics from durable control-plane state", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-metrics-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    await store.addIncident({
      id: "INC-1", source: "test", externalId: "one", title: "One", status: "open",
      receivedAt: "2026-08-25T00:00:00.000Z", payloadDigest: "digest",
    }, {
      id: "RUN-1", incidentId: "INC-1", repository: "acme/app", status: "retry_wait",
      attempts: 1, maxAttempts: 3, cancelRequested: false,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
    });
    await store.upsertHeartbeat({
      service: "worker", instanceId: "worker-1", status: "ready",
      observedAt: "2026-08-25T00:00:30.000Z",
    });

    const output = await operationalMetrics(store, new Date("2026-08-25T00:01:00.000Z"));
    expect(output).toContain('software_oath_runs{status="retry_wait"} 1');
    expect(output).toContain("software_oath_runs_active 1");
    expect(output).toContain("software_oath_worker_heartbeat_age_seconds 30");
  });

  it("emits machine-readable structured events", () => {
    expect(JSON.parse(structuredLog("request.completed", {
      correlationId: "correlation-1", status: 200,
    }))).toMatchObject({
      level: "info", event: "request.completed",
      correlationId: "correlation-1", status: 200,
    });
  });
});

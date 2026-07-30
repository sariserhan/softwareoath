import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileControlPlaneStore } from "./store";
import type { HostedRunRecord, IncidentRecord } from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("control plane store", () => {
  it("deduplicates Sentry incidents and records human decisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-store-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "data.json"));
    const incident: IncidentRecord = {
      id: "INC-1",
      source: "sentry",
      externalId: "42",
      title: "Failure",
      status: "unresolved",
      receivedAt: "2026-07-30T00:00:00Z",
      payloadDigest: "abc",
    };
    const run: HostedRunRecord = {
      id: "RUN-1",
      incidentId: incident.id,
      repository: "owner/repo",
      status: "awaiting_approval",
      createdAt: incident.receivedAt,
      updatedAt: incident.receivedAt,
    };

    expect((await store.addIncident(incident, run)).duplicate).toBe(false);
    expect((await store.addIncident({ ...incident, id: "INC-2" }, { ...run, id: "RUN-2" })).duplicate).toBe(true);
    const updated = await store.decide({
      id: "APPROVAL-1",
      runId: run.id,
      decision: "approved",
      actor: "reviewer@example.com",
      reason: "Evidence reviewed.",
      createdAt: "2026-07-30T00:01:00Z",
    });

    expect(updated.status).toBe("completed");
    expect(await store.listRuns()).toHaveLength(1);
    await expect(
      store.decide({
        id: "APPROVAL-2",
        runId: run.id,
        decision: "rejected",
        actor: "reviewer@example.com",
        reason: "Changed my mind.",
        createdAt: "2026-07-30T00:02:00Z",
      }),
    ).rejects.toThrow("is not awaiting approval");
  });
});

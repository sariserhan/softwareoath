import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileControlPlaneStore } from "./store";
import type {
  FinalAttestation,
  HostedRunRecord,
  IncidentRecord,
} from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("control plane store", () => {
  it("reclaims an active run after its worker lease expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-store-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "data.json"));
    const started = new Date("2026-07-30T00:00:00Z");
    const incident: IncidentRecord = {
      id: "INC-LEASE",
      source: "stewardship",
      externalId: "lease-test",
      title: "Lease recovery",
      status: "unresolved",
      receivedAt: started.toISOString(),
      payloadDigest: "lease",
    };
    const run: HostedRunRecord = {
      id: "RUN-LEASE",
      incidentId: incident.id,
      repository: "owner/repo",
      status: "received",
      attempts: 0,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: started.toISOString(),
      updatedAt: started.toISOString(),
    };
    await store.addIncident(incident, run);

    const first = await store.claimRun("worker-a", 1_000, started);
    expect(first).toMatchObject({ attempts: 1, leaseOwner: "worker-a" });
    await store.updateRun(
      run.id,
      {
        status: "repairing",
        error: "Transient clone failure",
        nextAttemptAt: new Date(started.getTime() + 900).toISOString(),
      },
      started,
    );
    await expect(
      store.claimRun("worker-b", 1_000, new Date(started.getTime() + 500)),
    ).resolves.toBeUndefined();
    await expect(
      store.claimRun("worker-b", 1_000, new Date(started.getTime() + 1_001)),
    ).resolves.toMatchObject({
      id: run.id,
      status: "repairing",
      attempts: 2,
      leaseOwner: "worker-b",
      error: undefined,
      nextAttemptAt: undefined,
    });
  });

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
      attempts: 0,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: incident.receivedAt,
      updatedAt: incident.receivedAt,
    };

    expect((await store.addIncident(incident, run)).duplicate).toBe(false);
    expect((await store.addIncident({ ...incident, id: "INC-2" }, { ...run, id: "RUN-2" })).duplicate).toBe(true);
    const attestation = {
      id: "ATTESTATION-1",
      runId: run.id,
    } as FinalAttestation;
    const updated = await store.decide({
      id: "APPROVAL-1",
      runId: run.id,
      decision: "approved",
      actor: "reviewer@example.com",
      identity: {
        provider: "github",
        providerUserId: "42",
        login: "reviewer",
      },
      authorization: {
        repository: run.repository,
        permission: "push",
        verifiedAt: "2026-07-30T00:01:00Z",
      },
      reason: "Evidence reviewed.",
      createdAt: "2026-07-30T00:01:00Z",
    }, attestation);

    expect(updated.status).toBe("completed");
    expect(await store.listRuns()).toHaveLength(1);
    await expect(
      store.decide({
        id: "APPROVAL-2",
        runId: run.id,
        decision: "rejected",
        actor: "reviewer@example.com",
        identity: {
          provider: "github",
          providerUserId: "42",
          login: "reviewer",
        },
        authorization: {
          repository: run.repository,
          permission: "push",
          verifiedAt: "2026-07-30T00:02:00Z",
        },
        reason: "Changed my mind.",
        createdAt: "2026-07-30T00:02:00Z",
      }, attestation),
    ).rejects.toThrow("is not awaiting approval");
  });
});

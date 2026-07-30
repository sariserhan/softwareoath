import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresControlPlaneStore, runMigrations } from "./postgres";
import type { HostedRunRecord, IncidentRecord } from "./types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const store = databaseUrl
  ? PostgresControlPlaneStore.fromConnectionString(databaseUrl)
  : undefined;

describeDatabase("PostgreSQL control plane", () => {
  beforeAll(async () => {
    await runMigrations(store!.pool);
    await store!.pool.query(
      "TRUNCATE stewardship_repositories, audit_events, auth_sessions, final_attestations, approvals, run_logs, runs, incidents, repository_mappings CASCADE",
    );
  });

  afterAll(async () => {
    await store?.pool.end();
  });

  it("deduplicates incidents and leases one run to only one worker", async () => {
    const suffix = randomUUID();
    const now = new Date("2026-07-30T12:00:00Z").toISOString();
    const incident: IncidentRecord = {
      id: `INC-${suffix}`,
      source: "sentry",
      externalId: `SENTRY-${suffix}`,
      title: "Database fixture",
      status: "unresolved",
      project: "fixture",
      receivedAt: now,
      payloadDigest: "digest",
    };
    const run: HostedRunRecord = {
      id: `RUN-${suffix}`,
      incidentId: incident.id,
      repository: "fixture/app",
      status: "received",
      attempts: 0,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    };

    expect((await store!.addIncident(incident, run)).duplicate).toBe(false);
    expect(
      (await store!.addIncident({ ...incident, id: "duplicate" }, run)).duplicate,
    ).toBe(true);
    const claims = await Promise.all([
      store!.claimRun("worker-a", 60_000, new Date(now)),
      store!.claimRun("worker-b", 60_000, new Date(now)),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ attempts: 1 });
  });
});

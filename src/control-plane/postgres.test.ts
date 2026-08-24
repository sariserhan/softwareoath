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
      "TRUNCATE repository_questions, repository_knowledge, stewardship_repositories, audit_events, auth_sessions, final_attestations, approvals, run_logs, runs, incidents, repository_mappings CASCADE",
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
  it("persists optimizer analyses with registered-repository ownership", async () => {
    const suffix = randomUUID();
    const now = "2026-08-24T00:00:00.000Z";
    const repository = "fixture/optimizer-" + suffix;
    const repositoryId = "REPOSITORY-" + suffix;
    await store!.upsertRepository({
      id: repositoryId,
      repository,
      cloneUrl: "https://github.test/" + repository + ".git",
      defaultBranch: "main",
      installationId: 42,
      schedule: { mode: "disabled", timezone: "UTC" },
      policy: {
        maxPullRequestsPerRun: 1,
        maxCiRepairAttempts: 2,
        allowMajorPackageUpdates: false,
        automaticMerge: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    const analysis = {
      version: 1 as const,
      id: "OPTIMIZER-" + suffix,
      tenantKey: "github-installation:42",
      repositoryId,
      repository,
      commit: "a".repeat(40),
      status: "completed" as const,
      filesAnalyzed: 1,
      bytesAnalyzed: 10,
      signals: [],
      observations: [],
      capabilities: [],
      warnings: [],
      analyzerVersion: "optimizer-static-o1",
      createdAt: now,
      completedAt: now,
    };
    await expect(store!.saveOptimizerAnalysis(analysis)).resolves.toEqual(analysis);
    await expect(store!.getOptimizerAnalysis(analysis.id)).resolves.toEqual(analysis);
    await expect(store!.listOptimizerAnalyses(repository)).resolves.toEqual([analysis]);
    await expect(store!.saveOptimizerAnalysis({
      ...analysis,
      tenantKey: "github-installation:99",
    })).rejects.toThrow(/ownership cannot be changed/);
  });
});

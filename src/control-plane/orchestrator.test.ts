import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { LocalArtifactStore } from "./artifacts";
import { RepairOrchestrator } from "./orchestrator";
import { FileControlPlaneStore } from "./store";
import type { HostedRunRecord, IncidentRecord } from "./types";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repositoryFixture(root: string): Promise<string> {
  const repository = join(root, "origin");
  await execFileAsync("git", ["init", "-q", "-b", "main", repository]);
  await writeFile(join(repository, "status.txt"), "unhealthy\n");
  await writeFile(
    join(repository, "software-oath.yml"),
    `version: 1
application:
  name: Worker fixture
  repository: fixture/app
  defaultBranch: main
approval:
  requireHumanFor: []
  allowAutomaticMerge: false
rules:
  - id: app.health
    title: Application is healthy
    description: The status file must say healthy.
    severity: high
    evidence:
      - kind: command
        command: node -e "const fs=require('fs'); process.exit(fs.readFileSync('status.txt','utf8').trim()==='healthy'?0:1)"
        required: true
    repair:
      allowedPaths:
        - status.txt
      automaticCandidate: true
`,
  );
  await execFileAsync("git", ["add", "."], { cwd: repository });
  await execFileAsync("git", ["commit", "-qm", "Add failing fixture"], {
    cwd: repository,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
  return repository;
}

describe("repair orchestrator", () => {
  it("carries an incident through repair, verification, push, and draft PR", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-orchestrator-"));
    roots.push(root);
    const repository = await repositoryFixture(root);
    const store = new FileControlPlaneStore(join(root, "control-plane.json"));
    const now = "2026-07-30T12:00:00.000Z";
    const incident: IncidentRecord = {
      id: "INC-1",
      source: "sentry",
      externalId: "42",
      title: "Application unhealthy",
      status: "unresolved",
      project: "fixture",
      receivedAt: now,
      payloadDigest: "digest",
    };
    const run: HostedRunRecord = {
      id: "RUN-1",
      incidentId: incident.id,
      repository: "fixture/app",
      status: "received",
      attempts: 0,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    };
    await store.addIncident(incident, run);
    await store.upsertMapping({
      id: "MAPPING-1",
      sentryProject: "fixture",
      repository: "fixture/app",
      cloneUrl: repository,
      localPath: repository,
      defaultBranch: "main",
      installationId: 1,
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertRepository({
      id: "REPOSITORY-1",
      repository: "fixture/app",
      cloneUrl: repository,
      localPath: repository,
      defaultBranch: "main",
      installationId: 1,
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
    const orchestrator = new RepairOrchestrator({
      store,
      workerId: "worker-1",
      artifacts: new LocalArtifactStore(join(root, "artifacts")),
      agent: {
        name: "fixture-agent",
        async repair({ workspacePath }) {
          await writeFile(join(workspacePath, "status.txt"), "healthy\n");
          return { summary: "Made the fixture healthy.", output: "done" };
        },
      },
      github: {
        async installationToken() {
          return "installation-token";
        },
        async openRepairPullRequest() {
          return { number: 7, html_url: "https://github.test/pr/7" };
        },
        async checkCommit() {
          return { state: "success", total: 2, failed: [] };
        },
      },
    });

    await orchestrator.processNext();
    await orchestrator.monitorCi();
    const result = await store.getRun(run.id);

    expect(result).toMatchObject({
      status: "awaiting_approval",
      pullRequestUrl: "https://github.test/pr/7",
      attempts: 1,
    });
    expect(result?.repairId).toMatch(/^REPAIR-/);
    expect(await store.listLogs(run.id)).toHaveLength(6);
    expect(
      await readFile(
        join(root, "artifacts", result!.repairId!, "receipt.json"),
        "utf8",
      ),
    ).toContain('"selectedFindingResolved": true');
  }, 15_000);

  it("schedules a retry when repository mapping is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-orchestrator-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "control-plane.json"));
    const incident: IncidentRecord = {
      id: "INC-2",
      source: "sentry",
      externalId: "43",
      title: "Unmapped failure",
      status: "unresolved",
      project: "missing",
      receivedAt: "2026-07-30T12:00:00Z",
      payloadDigest: "digest",
    };
    await store.addIncident(incident, {
      id: "RUN-2",
      incidentId: incident.id,
      repository: "unmapped",
      status: "received",
      attempts: 0,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: incident.receivedAt,
      updatedAt: incident.receivedAt,
    });
    const orchestrator = new RepairOrchestrator({
      store,
      workerId: "worker-1",
      artifacts: new LocalArtifactStore(join(root, "artifacts")),
      now: () => new Date("2026-07-30T12:00:00Z"),
    });

    const result = await orchestrator.processNext();

    expect(result).toMatchObject({
      status: "retry_wait",
      attempts: 1,
      error: "No repository mapping exists for Sentry project missing.",
    });
    expect(result?.nextAttemptAt).toBe("2026-07-30T12:01:00.000Z");
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { LocalArtifactStore } from "./artifacts.js";
import { RepairOrchestrator } from "./orchestrator.js";
import { FileControlPlaneStore } from "./store.js";
import type { HostedRunRecord, IncidentRecord } from "./types.js";

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
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ dependencies: { resend: "^4.0.0" } }),
  );
  await writeFile(
    join(repository, "email.ts"),
    'import { Resend } from "resend";\n' +
      'export const send = (client: Resend) => client.emails.send({ text: "Hi" });\n',
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
      source: "stewardship",
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
    const baseCommit = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repository })
    ).stdout.trim();
    let checkedRef: string | undefined;
    const orchestrator = new RepairOrchestrator({
      store,
      workerId: "worker-1",
      artifacts: new LocalArtifactStore(join(root, "artifacts")),
      optimizerAnalysisEnabled: true,
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
        async checkCommit(options) {
          checkedRef = options.ref;
          return { state: "success", total: 2, failed: [] };
        },
      },
    });

    await orchestrator.processNext();
    await orchestrator.monitorCi();
    const result = await store.getRun(run.id);

    expect(result?.error).toBeUndefined();
    expect(result).toMatchObject({
      status: "awaiting_approval",
      pullRequestUrl: "https://github.test/pr/7",
      attempts: 1,
      commit: baseCommit,
    });
    expect(result?.repairId).toMatch(/^REPAIR-/);
    expect(checkedRef).toBe(result?.repairCommit);
    expect(await store.listLogs(run.id)).toHaveLength(9);
    expect(await store.listOptimizerAnalyses("fixture/app")).toEqual([
      expect.objectContaining({
        tenantKey: "github-installation:1",
        repositoryId: "REPOSITORY-1",
        commit: baseCommit,
        status: "completed",
        observations: [expect.objectContaining({
          serviceId: "resend",
          status: "active",
        })],
        capabilities: expect.arrayContaining([
          expect.objectContaining({ capabilityId: "transactional_send" }),
          expect.objectContaining({ capabilityId: "text_email" }),
        ]),
      }),
    ]);
    expect(await store.listKnowledge("fixture/app")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "observed_technical_fact",
          source: expect.objectContaining({ runId: run.id }),
        }),
      ]),
    );
    expect(await store.listQuestions("fixture/app")).toHaveLength(3);
    expect(
      await readFile(
        join(root, "artifacts", result!.repairId!, "receipt.json"),
        "utf8",
      ),
    ).toContain('"selectedFindingResolved": true');
  }, 15_000);

  it("generates a protected initial oath draft when the repository has no oath", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-orchestrator-"));
    roots.push(root);
    const repository = await repositoryFixture(root);
    await rm(join(repository, "software-oath.yml"));
    await writeFile(join(repository, "package.json"), JSON.stringify({
      scripts: { test: "vitest run", lint: "eslint ." },
    }));
    await execFileAsync("git", ["add", "--all"], { cwd: repository });
    await execFileAsync("git", ["commit", "-qm", "Remove oath"], {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture.com",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture.com",
      },
    });
    const store = new FileControlPlaneStore(join(root, "control-plane.json"));
    const now = "2026-07-30T12:00:00.000Z";
    const incident: IncidentRecord = {
      id: "SCAN-NO-OATH", source: "stewardship", externalId: "no-oath",
      title: "Initial scan", status: "open", receivedAt: now, payloadDigest: "no-oath",
    };
    await store.addIncident(incident, {
      id: "RUN-NO-OATH", incidentId: incident.id, repository: "fixture/no-oath",
      status: "received", attempts: 0, maxAttempts: 3, cancelRequested: false,
      createdAt: now, updatedAt: now,
    });
    await store.upsertRepository({
      id: "REPOSITORY-NO-OATH", repository: "fixture/no-oath", cloneUrl: repository,
      localPath: repository, defaultBranch: "main",
      schedule: { mode: "disabled", timezone: "UTC" },
      policy: { maxPullRequestsPerRun: 1, maxCiRepairAttempts: 2,
        allowMajorPackageUpdates: false, automaticMerge: false },
      createdAt: now, updatedAt: now,
    });
    const artifacts = new LocalArtifactStore(join(root, "artifacts"));
    const orchestrator = new RepairOrchestrator({
      store, workerId: "worker-1", artifacts, now: () => new Date(now),
    });

    const result = await orchestrator.processNext();
    const draft = await artifacts.readInitialOathDraft("fixture/no-oath");

    expect(result).toMatchObject({ status: "completed", decision: "review_required" });
    expect(draft.source).toContain("repository: fixture/no-oath");
    expect(draft.source).toContain("defaultBranch: main");
    expect(draft.discoveredChecks.map(({ command }) => command)).toEqual([
      "npm test", "npm run lint",
    ]);
    expect(await store.listLogs("RUN-NO-OATH")).toEqual([
      expect.objectContaining({ message: "Checking out fixture/no-oath." }),
      expect.objectContaining({
        message: expect.stringContaining("Generated an initial oath draft from 2"),
      }),
    ]);
  });

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

  it("keeps a repair unapprovable when GitHub CI fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-orchestrator-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "control-plane.json"));
    const now = "2026-07-30T12:00:00.000Z";
    const incident: IncidentRecord = {
      id: "INC-CI-FAILURE",
      source: "stewardship",
      externalId: "ci-failure",
      title: "Dependency repair",
      status: "unresolved",
      receivedAt: now,
      payloadDigest: "ci-failure",
    };
    const run: HostedRunRecord = {
      id: "RUN-CI-FAILURE",
      incidentId: incident.id,
      repository: "fixture/app",
      commit: "base-commit",
      repairCommit: "repair-commit",
      status: "ci_pending",
      decision: "ready",
      attempts: 1,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    };
    await store.addIncident(incident, run);
    await store.upsertRepository({
      id: "REPOSITORY-CI-FAILURE",
      repository: "fixture/app",
      cloneUrl: "https://github.test/fixture/app.git",
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
      github: {
        async installationToken() {
          return "installation-token";
        },
        async openRepairPullRequest() {
          throw new Error("not used");
        },
        async checkCommit() {
          return { state: "failure" as const, total: 2, failed: ["build"] };
        },
      },
    });

    await expect(orchestrator.monitorCi()).resolves.toBe(1);

    expect(await store.getRun(run.id)).toMatchObject({
      status: "ci_failed",
      decision: "ready",
      error: "CI failed: build",
    });
    expect(await store.listLogs(run.id)).toEqual([
      expect.objectContaining({
        level: "error",
        message: "CI failed and the pull request remains unmergeable: build.",
      }),
    ]);

    const pollingRun: HostedRunRecord = {
      ...run,
      id: "RUN-CI-POLL-FAILURE",
      incidentId: "INC-CI-POLL-FAILURE",
      status: "ci_pending",
      error: undefined,
    };
    await store.addIncident(
      { ...incident, id: pollingRun.incidentId, externalId: "ci-poll-failure" },
      pollingRun,
    );
    const unavailableGitHub = new RepairOrchestrator({
      store,
      workerId: "worker-1",
      github: {
        async installationToken() {
          return "installation-token";
        },
        async openRepairPullRequest() {
          throw new Error("not used");
        },
        async checkCommit() {
          throw new Error("GitHub unavailable");
        },
      },
    });

    await expect(unavailableGitHub.monitorCi()).resolves.toBe(0);
    expect(await store.getRun(pollingRun.id)).toMatchObject({
      status: "ci_pending",
      decision: "ready",
    });
    expect(await store.listLogs(pollingRun.id)).toEqual([
      expect.objectContaining({
        level: "warning",
        message:
          "CI status check failed; approval remains unavailable: GitHub unavailable",
      }),
    ]);
  });
});

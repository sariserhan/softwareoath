import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { GitHubAppClient } from "../integrations/github.js";
import { analyzeRepositoryStatic } from "../optimizer/analyze.js";
import { initializeRepository } from "../onboarding/init.js";
import {
  isolatedDependencyCommandRunner,
  prepareNpmWorkspace,
} from "../runner/npm.js";
import { runRepair } from "../repair/run.js";
import type { RepairAgent } from "../repair/types.js";
import type { InfracostScanner } from "../integrations/infracost.js";
import {
  verifyReceiptSignature,
  type ReceiptSigner,
  type TrustedReceiptKeys,
} from "../repair/signature.js";
import type { TrustedRunner } from "../runner/types.js";
import type { ArtifactStore } from "./artifacts.js";
import type {
  ControlPlaneStore,
  HostedRunRecord,
  RepositoryMapping,
  RunLogRecord,
} from "./types.js";
import { scanRepositoryMemory } from "../steward/memory.js";
import { synchronizeRepositoryKnowledge } from "../steward/knowledge.js";
import { assertSafeRepositoryWorkspace } from "../runner/workspace.js";

const execFileAsync = promisify(execFile);

async function git(
  cwd: string,
  args: string[],
  token?: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  if (token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 =
      "Authorization: " +
      "Basic " +
      Buffer.from(`x-access-token:${token}`).toString("base64");
  }
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function sandboxGit(
  runner: TrustedRunner,
  workspacePath: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<string> {
  const environment = Object.entries(extraEnv)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}=${shellArgument(value)}`);
  const command = [...environment, "git", ...args.map(shellArgument)].join(" ");
  const result = await runner.execute({ command, workspacePath, timeoutMs: 10 * 60_000 });
  if (result.exitCode !== 0) {
    throw new Error(`Sandbox git exited with code ${result.exitCode}: ${result.output}`);
  }
  return result.output.trim();
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length) {
    throw new Error(`Repository ${repository} must use owner/name format.`);
  }
  return { owner, repo };
}

export interface OrchestratorOptions {
  store: ControlPlaneStore;
  workerId: string;
  leaseMs?: number;
  runner?: TrustedRunner;
  preparationRunner?: TrustedRunner;
  repositoryGitRunner?: (installationToken?: string) => TrustedRunner;
  costScanner?: InfracostScanner;
  github?: Pick<
    GitHubAppClient,
    "installationToken" | "openRepairPullRequest" | "checkCommit"
  >;
  agent?: RepairAgent;
  artifacts: ArtifactStore;
  now?: () => Date;
  optimizerAnalysisEnabled?: boolean;
  signer?: ReceiptSigner;
  trustedKeys?: TrustedReceiptKeys;
  publicUrl?: string;
}

export class RepairOrchestrator {
  private readonly leaseMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: OrchestratorOptions) {
    this.leaseMs = options.leaseMs ?? 15 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  private async log(
    runId: string,
    message: string,
    level: RunLogRecord["level"] = "info",
  ): Promise<void> {
    await this.options.store.appendLog({
      id: `LOG-${randomUUID()}`,
      runId,
      level,
      message,
      createdAt: this.now().toISOString(),
    });
  }

  private async assertActive(runId: string): Promise<HostedRunRecord> {
    const run = await this.options.store.getRun(runId);
    if (!run) throw new Error(`Run ${runId} disappeared.`);
    if (run.cancelRequested) {
      await this.options.store.updateRun(runId, {
        status: "cancelled",
        leaseExpiresAt: this.now().toISOString(),
      });
      throw new Error("Run cancellation requested.");
    }
    return run;
  }

  private async installationToken(
    mapping: Pick<RepositoryMapping, "installationId">,
  ): Promise<string | undefined> {
    if (!mapping.installationId) return undefined;
    if (!this.options.github) {
      throw new Error("GitHub App credentials are required for this repository.");
    }
    return await this.options.github.installationToken(mapping.installationId);
  }

  async processNext(): Promise<HostedRunRecord | undefined> {
    const claimed = await this.options.store.claimRun(
      this.options.workerId,
      this.leaseMs,
      this.now(),
    );
    if (!claimed) return undefined;
    await this.process(claimed);
    return await this.options.store.getRun(claimed.id);
  }

  async process(claimed: HostedRunRecord): Promise<void> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "software-oath-worker-"));
    const workspace = join(temporaryRoot, "repository");
    try {
      const incident = await this.options.store.getIncident(claimed.incidentId);
      if (!incident) throw new Error(`Incident ${claimed.incidentId} was not found.`);
      const mapping =
        incident.source === "stewardship"
          ? await this.options.store.getRepository(claimed.repository)
          : incident.project
            ? await this.options.store.findMapping(incident.project)
            : undefined;
      if (!mapping) {
        throw new Error(
          incident.source === "stewardship"
            ? `Repository ${claimed.repository} is not registered for stewardship.`
            : `No repository mapping exists for Sentry project ${incident.project ?? "unknown"}.`,
        );
      }
      const token = await this.installationToken(mapping);
      const repositoryGitRunner = this.options.repositoryGitRunner?.(token);
      await this.options.store.updateRun(claimed.id, {
        status: "reproducing",
      });
      await this.log(claimed.id, `Checking out ${mapping.repository}.`);
      if (repositoryGitRunner) {
        await mkdir(workspace, { recursive: true });
        await sandboxGit(repositoryGitRunner, workspace, [
          "clone", "--no-checkout", mapping.cloneUrl, ".",
        ]);
      } else {
        await git(temporaryRoot, ["clone", "--no-checkout", mapping.localPath ?? mapping.cloneUrl, workspace], token);
      }
      const repositoryGit = (
        args: string[],
        credential?: string,
        extraEnv?: NodeJS.ProcessEnv,
      ) => repositoryGitRunner
        ? sandboxGit(repositoryGitRunner, workspace, args, extraEnv)
        : git(workspace, args, credential, extraEnv);
      const requestedRef =
        incident.release ?? `origin/${mapping.defaultBranch}`;
      const commit = await repositoryGit([
        "rev-parse",
        "--verify",
        `${requestedRef}^{commit}`,
      ]);
      await repositoryGit(["checkout", "--detach", commit], token);
      await this.options.store.updateRun(claimed.id, { commit });
      const trackedFiles = (await repositoryGit(["ls-files", "-z"]))
        .split("\0")
        .filter(Boolean);
      await assertSafeRepositoryWorkspace(workspace);
      const oathPath = join(workspace, "software-oath.yml");
      const hasOath = await access(oathPath).then(() => true, () => false);
      if (!hasOath) {
        const draft = await initializeRepository({
          repositoryPath: workspace,
          repository: mapping.repository,
          applicationName: repositoryParts(mapping.repository).repo,
          defaultBranch: mapping.defaultBranch,
          dryRun: true,
        });
        await this.options.artifacts.saveInitialOathDraft({
          repository: mapping.repository,
          source: draft.source,
          discoveredChecks: draft.discoveredChecks,
          warnings: draft.warnings,
          generatedAt: this.now().toISOString(),
        });
        await this.options.store.updateRun(claimed.id, {
          status: "completed",
          decision: "review_required",
          leaseExpiresAt: this.now().toISOString(),
        });
        await this.log(
          claimed.id,
          "Generated an initial oath draft from " +
            draft.discoveredChecks.length +
            " repository-owned checks; owner review is required.",
        );
        return;
      }
      if (this.options.preparationRunner) {
        const lockfile = join(workspace, "package-lock.json");
        if (await access(lockfile).then(() => true, () => false)) {
          await this.log(claimed.id, "Preparing locked npm dependencies in the isolated network runner.");
          await prepareNpmWorkspace({
            workspacePath: workspace,
            runner: this.options.preparationRunner,
          });
        }
      }
      const memory = await scanRepositoryMemory({
        repositoryPath: workspace,
        repositorySnapshot: { files: trackedFiles, commit, branch: "(detached)" },
        memoryPath: this.options.artifacts.memoryPath(mapping.repository),
        now: this.now,
        allowMajorPackageUpdates:
          "policy" in mapping ? mapping.policy.allowMajorPackageUpdates : false,
        dependencyCommandRunner: this.options.preparationRunner
          ? isolatedDependencyCommandRunner(workspace, this.options.preparationRunner)
          : undefined,
        runner: this.options.runner,
      });
      await this.log(
        claimed.id,
        `Repository memory updated at ${memory.commit}: ${memory.inventory.trackedFiles} files, ${memory.health.total} findings.`,
      );
      await this.log(
        claimed.id,
        `Capability plan selected ${memory.capabilities?.activeAdapters.join(", ") || "no active dependency adapters"}; coverage gaps: ${
          memory.capabilities?.coverageGaps.length
            ? memory.capabilities.coverageGaps
                .map(
                  ({ ecosystem, workspacePath }) =>
                    `${ecosystem}@${workspacePath}`,
                )
                .join(", ")
            : "none"
        }.`,
        memory.capabilities?.coverageGaps.length ? "warning" : "info",
      );
      const knowledge = await synchronizeRepositoryKnowledge({
        store: this.options.store,
        memory,
        runId: claimed.id,
        now: this.now,
      });
      await this.log(
        claimed.id,
        `Repository knowledge synchronized: ${knowledge.knowledge} durable facts and ${knowledge.openQuestions} open owner questions.`,
        knowledge.openQuestions ? "warning" : "info",
      );
      if (this.options.optimizerAnalysisEnabled && "policy" in mapping) {
        const startedAt = this.now().toISOString();
        const staticAnalysis = await analyzeRepositoryStatic({
          repositoryPath: workspace,
          repositorySnapshot: { files: trackedFiles, commit },
        });
        const completedAt = this.now().toISOString();
        const tenantKey = mapping.installationId
          ? "github-installation:" + mapping.installationId
          : "local-repository:" + mapping.id;
        const optimizerAnalysis = await this.options.store.saveOptimizerAnalysis({
          version: 1,
          id: "OPTIMIZER-" + randomUUID(),
          tenantKey,
          repositoryId: mapping.id,
          repository: mapping.repository,
          commit: staticAnalysis.commit,
          status: "completed",
          filesAnalyzed: staticAnalysis.filesAnalyzed,
          bytesAnalyzed: staticAnalysis.bytesAnalyzed,
          signals: staticAnalysis.signals,
          observations: staticAnalysis.observations,
          capabilities: staticAnalysis.capabilities,
          unknowns: staticAnalysis.unknowns,
          ownerDecisions: [],
          warnings: staticAnalysis.warnings,
          analyzerVersion: staticAnalysis.analyzerVersion,
          createdAt: startedAt,
          completedAt,
        });
        const evidencePaths = [
          ...new Set(
            [
              ...optimizerAnalysis.signals.map((signal) => signal.evidence),
              ...optimizerAnalysis.observations.flatMap(
                (observation) => observation.evidence,
              ),
              ...optimizerAnalysis.capabilities.flatMap(
                (capability) => capability.evidence,
              ),
            ].map((item) => item.file),
          ),
        ].sort();
        await this.options.store.upsertKnowledge({
          id: "KNOWLEDGE-OPTIMIZER-" + mapping.id,
          repository: mapping.repository,
          kind: "observed_technical_fact",
          statement:
            "Read-only optimizer analysis recorded " +
            optimizerAnalysis.signals.length +
            " normalized signals, " +
            optimizerAnalysis.observations.length +
            " external-service observations, and " +
            optimizerAnalysis.capabilities.length +
            " capability findings.",
          scope: { type: "repository", value: mapping.repository },
          source: {
            type: "scan",
            runId: claimed.id,
            commit: optimizerAnalysis.commit,
            evidence: evidencePaths,
          },
          confidence: 1,
          relatedPaths: evidencePaths,
          blocksRepair: false,
          firstObservedAt: completedAt,
          lastVerifiedAt: completedAt,
          firstObservedCommit: optimizerAnalysis.commit,
          lastVerifiedCommit: optimizerAnalysis.commit,
          createdAt: completedAt,
          updatedAt: completedAt,
        });
        await this.options.store.appendAudit({
          id: "AUDIT-" + randomUUID(),
          action: "optimizer.analyze",
          outcome: "success",
          repository: mapping.repository,
          runId: claimed.id,
          detail:
            "Read-only optimizer analysis " + optimizerAnalysis.id + " recorded " +
            optimizerAnalysis.signals.length + " normalized signals at " +
            optimizerAnalysis.commit + ".",
          createdAt: completedAt,
        });
        await this.log(
          claimed.id,
          "Read-only optimizer analysis recorded " +
            optimizerAnalysis.signals.length +
            " normalized signals; no repository code was executed.",
        );
      }
      await this.assertActive(claimed.id);
      if (!memory.findings.some(({ automaticCandidate }) => automaticCandidate)) {
        await this.options.store.updateRun(claimed.id, {
          status: "completed",
          decision: memory.health.total > 0 ? "review_required" : "ready",
          leaseExpiresAt: this.now().toISOString(),
        });
        await this.log(
          claimed.id,
          memory.health.total > 0
            ? "Scan completed with suggestions; no bounded automatic repair was authorized."
            : "Scan completed cleanly; no repair pull request is needed.",
        );
        return;
      }
      if (!this.options.agent) {
        await this.options.store.updateRun(claimed.id, {
          status: "completed",
          decision: "review_required",
          leaseExpiresAt: this.now().toISOString(),
        });
        await this.log(
          claimed.id,
          "Scan found an automatic repair candidate, but no isolated repair agent is configured; owner review is required.",
          "warning",
        );
        return;
      }
      await this.options.store.updateRun(claimed.id, { status: "repairing" });
      await this.log(claimed.id, "Running bounded repair agent.");
      const receipt = await runRepair({
        repositoryPath: workspace,
        agent: this.options.agent,
        runner: this.options.runner,
        preparationRunner: this.options.preparationRunner,
        costScanner: this.options.costScanner,
        signer: this.options.signer,
        includeDependencyChecks: incident.source === "stewardship",
        allowMajorPackageUpdates:
          "policy" in mapping ? mapping.policy.allowMajorPackageUpdates : false,
      });
      verifyReceiptSignature(receipt, this.options.trustedKeys);
      await this.options.artifacts.saveRepair(receipt, this.options.trustedKeys);
      await this.options.store.updateRun(claimed.id, {
        status: "verifying",
        repairId: receipt.id,
        decision: receipt.decision,
      });
      await this.log(
        claimed.id,
        `Verification decision: ${receipt.decision}; original finding ${receipt.proof.selectedFindingResolved ? "resolved" : "unresolved"}.`,
      );
      await this.assertActive(claimed.id);
      verifyReceiptSignature(receipt, this.options.trustedKeys);
      if (receipt.decision === "blocked") {
        await this.options.store.updateRun(claimed.id, {
          status: "blocked",
          error: "Repair failed deterministic acceptance.",
          leaseExpiresAt: this.now().toISOString(),
        });
        return;
      }

      const branch = `software-oath/${receipt.id.toLowerCase()}`;
      await repositoryGit(["switch", "-c", branch]);
      await repositoryGit(["apply", receipt.changes.patchPath]);
      await repositoryGit(["add", "--all"]);
      await repositoryGit(
        ["commit", "-m", `Repair: ${receipt.finding.title}`],
        undefined,
        {
          GIT_AUTHOR_NAME: "Software Oath",
          GIT_AUTHOR_EMAIL: "repairs@softwareoath.com",
          GIT_COMMITTER_NAME: "Software Oath",
          GIT_COMMITTER_EMAIL: "repairs@softwareoath.com",
        },
      );
      const repairCommit = await repositoryGit(["rev-parse", "HEAD"]);
      await this.options.store.updateRun(claimed.id, { repairCommit });
      await repositoryGit(["push", "origin", `HEAD:refs/heads/${branch}`], token);
      if (!mapping.installationId || !this.options.github) {
        throw new Error("GitHub installation is required to open the repair PR.");
      }
      const { owner, repo } = repositoryParts(mapping.repository);
      verifyReceiptSignature(receipt, this.options.trustedKeys);
      const pullRequest = await this.options.github.openRepairPullRequest({
        installationId: mapping.installationId,
        owner,
        repo,
        head: branch,
        base: mapping.defaultBranch,
        title: `[Software Oath] ${receipt.finding.title}`,
        body: [
          `Repair receipt: \`${receipt.id}\``,
          "",
          `Decision: **${receipt.decision}**`,
          `Original finding resolved: **${receipt.proof.selectedFindingResolved ? "yes" : "no"}**`,
          `New blocking findings: **${receipt.proof.blockingNewFindings.length}**`,
          ...(receipt.cost
            ? [
                `Cost analysis: **${receipt.cost.status.replaceAll("_", " ")}**`,
                `Monthly cost change: **${receipt.cost.monthlyCostChange ?? "unavailable"} ${receipt.cost.currency} (${receipt.cost.percentageChange ?? "unavailable"}%)**`,
              ]
            : []),
          ...(this.options.publicUrl
            ? [
                "",
                `Final signed attestation: ${this.options.publicUrl.replace(/\/$/, "")}/api/runs/${encodeURIComponent(claimed.id)}/receipt`,
              ]
            : []),
          "",
          "Human approval is required before merge.",
        ].join("\n"),
      });
      await this.options.store.updateRun(claimed.id, {
        status: "ci_pending",
        branch,
        pullRequestUrl: pullRequest.html_url,
        leaseExpiresAt: this.now().toISOString(),
      });
      await this.log(claimed.id, `Draft pull request opened: ${pullRequest.html_url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      const current = await this.options.store.getRun(claimed.id);
      if (current?.status === "cancelled") {
        await this.log(claimed.id, "Run cancelled by operator.", "warning");
        return;
      }
      const terminal = (current?.attempts ?? claimed.attempts) >= claimed.maxAttempts;
      const retryDelayMs = Math.min(
        60_000 * 2 ** Math.max(0, (current?.attempts ?? 1) - 1),
        60 * 60 * 1000,
      );
      await this.options.store.updateRun(claimed.id, {
        status: terminal ? "blocked" : "retry_wait",
        error: message,
        nextAttemptAt: terminal
          ? undefined
          : new Date(this.now().getTime() + retryDelayMs).toISOString(),
        leaseExpiresAt: this.now().toISOString(),
      });
      await this.log(
        claimed.id,
        terminal ? `Run failed permanently: ${message}` : `Run will retry: ${message}`,
        "error",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async monitorCi(): Promise<number> {
    if (!this.options.github) return 0;
    const pendingRuns = (await this.options.store.listRuns()).filter(
      (run) => run.status === "ci_pending" && run.repairCommit,
    );
    let changed = 0;
    for (const run of pendingRuns) {
      const registration = await this.options.store.getRepository(run.repository);
      if (!registration?.installationId) continue;
      const { owner, repo } = repositoryParts(run.repository);
      let checks;
      try {
        checks = await this.options.github.checkCommit({
          installationId: registration.installationId,
          owner,
          repo,
          ref: run.repairCommit!,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown GitHub error";
        await this.log(
          run.id,
          `CI status check failed; approval remains unavailable: ${message}`,
          "warning",
        );
        continue;
      }
      if (checks.state === "pending") continue;
      changed += 1;
      if (checks.state === "success") {
        await this.options.store.updateRun(run.id, { status: "awaiting_approval" });
        await this.log(
          run.id,
          `CI passed (${checks.total} checks). Owner review is now available.`,
        );
      } else {
        await this.options.store.updateRun(run.id, {
          status: "ci_failed",
          error: `CI failed: ${checks.failed.join(", ") || "unknown check"}`,
        });
        await this.log(
          run.id,
          `CI failed and the pull request remains unmergeable: ${checks.failed.join(", ") || "unknown check"}.`,
          "error",
        );
      }
    }
    return changed;
  }
}

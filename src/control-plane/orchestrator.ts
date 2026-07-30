import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { GitHubAppClient } from "../integrations/github";
import { CodexRepairAgent } from "../repair/codex";
import { runRepair } from "../repair/run";
import type { RepairAgent } from "../repair/types";
import type { TrustedRunner } from "../runner/types";
import { LocalArtifactStore } from "./artifacts";
import type {
  ControlPlaneStore,
  HostedRunRecord,
  RepositoryMapping,
  RunLogRecord,
} from "./types";

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
    env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${token}`;
  }
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
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
  github?: Pick<
    GitHubAppClient,
    "installationToken" | "openRepairPullRequest"
  >;
  agent?: RepairAgent;
  artifacts: LocalArtifactStore;
  now?: () => Date;
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
    mapping: RepositoryMapping,
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
      const mapping = incident.project
        ? await this.options.store.findMapping(incident.project)
        : undefined;
      if (!mapping) {
        throw new Error(
          `No repository mapping exists for Sentry project ${incident.project ?? "unknown"}.`,
        );
      }
      const token = await this.installationToken(mapping);
      await this.options.store.updateRun(claimed.id, {
        status: "reproducing",
        commit: incident.release,
      });
      await this.log(claimed.id, `Checking out ${mapping.repository}.`);
      await git(temporaryRoot, ["clone", "--no-checkout", mapping.localPath ?? mapping.cloneUrl, workspace], token);
      await git(
        workspace,
        ["checkout", incident.release ?? mapping.defaultBranch],
        token,
      );
      await this.assertActive(claimed.id);
      await this.options.store.updateRun(claimed.id, { status: "repairing" });
      await this.log(claimed.id, "Running bounded repair agent.");
      const receipt = await runRepair({
        repositoryPath: workspace,
        agent: this.options.agent ?? new CodexRepairAgent(),
        runner: this.options.runner,
      });
      await this.options.artifacts.saveRepair(receipt);
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
      if (receipt.decision === "blocked") {
        await this.options.store.updateRun(claimed.id, {
          status: "blocked",
          error: "Repair failed deterministic acceptance.",
          leaseExpiresAt: this.now().toISOString(),
        });
        return;
      }

      const branch = `software-oath/${receipt.id.toLowerCase()}`;
      await git(workspace, ["switch", "-c", branch]);
      await git(workspace, ["apply", receipt.changes.patchPath]);
      await git(workspace, ["add", "--all"]);
      await git(
        workspace,
        ["commit", "-m", `Repair: ${receipt.finding.title}`],
        undefined,
        {
          GIT_AUTHOR_NAME: "Software Oath",
          GIT_AUTHOR_EMAIL: "repairs@softwareoath.local",
          GIT_COMMITTER_NAME: "Software Oath",
          GIT_COMMITTER_EMAIL: "repairs@softwareoath.local",
        },
      );
      await git(workspace, ["push", "origin", `HEAD:refs/heads/${branch}`], token);
      if (!mapping.installationId || !this.options.github) {
        throw new Error("GitHub installation is required to open the repair PR.");
      }
      const { owner, repo } = repositoryParts(mapping.repository);
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
          "",
          "Human approval is required before merge.",
        ].join("\n"),
      });
      await this.options.store.updateRun(claimed.id, {
        status: "awaiting_approval",
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
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import { inspectRepository } from "../detector/inspect";
import type { RepositoryFinding } from "../detector/types";
import { runMaintenance } from "../maintainer/run";
import { compareRepairProof, repairDecision } from "./proof";
import type { RepairAgent, RepairReceipt } from "./types";

const execFileAsync = promisify(execFile);

interface RepairOptions {
  repositoryPath: string;
  agent: RepairAgent;
  findingId?: string;
  now?: () => Date;
}

function chooseFinding(
  findings: RepositoryFinding[],
  findingId?: string,
): RepositoryFinding {
  if (findingId) {
    const selected = findings.find(({ id }) => id === findingId);
    if (!selected) throw new Error(`Finding ${findingId} was not found.`);
    return selected;
  }
  const selected = findings.find(
    ({ repair }) => repair.automaticCandidate,
  );
  if (!selected) {
    throw new Error(
      "No automatic repair candidate was found. Pass --finding <id> to select a review-only finding.",
    );
  }
  return selected;
}

export function buildRepairPrompt(finding: RepositoryFinding): string {
  return `You are performing one bounded Software Oath maintenance repair.

Problem:
${finding.title}
${finding.summary}

Evidence:
${JSON.stringify(finding.evidence, null, 2)}

Repair objective:
${finding.repair.objective}

Hard boundaries:
- You may modify only these paths: ${finding.repair.allowedPaths.join(", ")}
- Do not modify software-oath.yml or weaken any test, rule, or validation command.
- Do not commit, push, open a pull request, or access files outside this workspace.
- Make the smallest behavior-preserving change that resolves the stated problem.
- You may inspect the repository and run commands needed to understand and validate the repair.
- If the repair cannot be completed inside these boundaries, make no changes and explain why.
`;
}

async function git(
  repositoryPath: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryPath,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

async function gitRaw(
  repositoryPath: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryPath,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

function isAllowed(path: string, allowedPaths: string[]): boolean {
  return allowedPaths.some(
    (allowed) => path === allowed || path.startsWith(`${allowed}/`),
  );
}

function repairId(now: Date): string {
  return `REPAIR-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

export async function runRepair(options: RepairOptions): Promise<RepairReceipt> {
  const repositoryPath = resolve(options.repositoryPath);
  const now = options.now ?? (() => new Date());
  const started = now();
  const id = repairId(started);
  const inspection = await inspectRepository({ repositoryPath, now });
  const finding = chooseFinding(inspection.findings, options.findingId);
  const baseCommit = await git(repositoryPath, ["rev-parse", "HEAD"]);
  const gitDirectory = resolve(
    repositoryPath,
    await git(repositoryPath, ["rev-parse", "--git-common-dir"]),
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "software-oath-repair-"));
  const workspacePath = join(temporaryRoot, "workspace");
  const artifactDirectory = join(gitDirectory, "software-oath", "repairs", id);
  let worktreeAdded = false;

  try {
    await git(repositoryPath, [
      "worktree",
      "add",
      "--detach",
      workspacePath,
      baseCommit,
    ]);
    worktreeAdded = true;

    const agentResult = await options.agent.repair({
      workspacePath,
      prompt: buildRepairPrompt(finding),
    });
    const changedOutput = await gitRaw(workspacePath, [
      "status",
      "--porcelain=v1",
      "-z",
    ]);
    const changedFiles = changedOutput
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3))
      .sort();
    const withinAllowedScope =
      changedFiles.length > 0 &&
      changedFiles.every((path) =>
        isAllowed(path, finding.repair.allowedPaths),
      );
    if (changedFiles.length > 0) {
      await execFileAsync("git", ["add", "--intent-to-add", "--", ...changedFiles], {
        cwd: workspacePath,
      });
    }

    const patch = await gitRaw(workspacePath, [
      "diff",
      "--binary",
      "--no-ext-diff",
    ]);
    const verification = await runMaintenance({
      repositoryPath: workspacePath,
      writeReceipt: false,
      now,
      incident: {
        title: finding.title,
        source: finding.detector,
        detectedAt: inspection.generatedAt,
      },
      repair: {
        summary: agentResult.summary,
        files: changedFiles,
        diff: patch.split("\n"),
      },
    });
    const afterInspection = await inspectRepository({
      repositoryPath: workspacePath,
      now,
      maintenanceReceipt: verification,
    });
    const proof = compareRepairProof(inspection, afterInspection, finding);
    const decision = repairDecision({
      withinAllowedScope,
      hasPatch: Boolean(patch),
      verificationDecision: verification.report.decision,
      proof,
    });

    await mkdir(artifactDirectory, { recursive: true });
    const patchPath = join(artifactDirectory, "repair.patch");
    await writeFile(patchPath, patch, "utf8");
    const receipt: RepairReceipt = {
      version: 1,
      id,
      repositoryPath,
      baseCommit,
      finding,
      inspection: inspection.summary,
      agent: {
        name: options.agent.name,
        summary: agentResult.summary,
        output: agentResult.output,
      },
      changes: {
        files: changedFiles,
        withinAllowedScope,
        patchPath,
        patchSha256: createHash("sha256").update(patch).digest("hex"),
      },
      proof,
      verification,
      decision,
      generatedAt: now().toISOString(),
    };
    await writeFile(
      join(artifactDirectory, "receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
    return receipt;
  } finally {
    if (worktreeAdded) {
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspacePath],
        { cwd: repositoryPath },
      ).catch(() => undefined);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function formatRepairReceipt(receipt: RepairReceipt): string {
  return [
    `Software Oath repair · ${basename(receipt.repositoryPath)}`,
    `Repair: ${receipt.id}`,
    `Problem: ${receipt.finding.title}`,
    `Agent: ${receipt.agent.name}`,
    `Changed: ${receipt.changes.files.join(", ") || "no files"}`,
    `Scope: ${receipt.changes.withinAllowedScope ? "valid" : "rejected"}`,
    `Original problem: ${receipt.proof.selectedFindingResolved ? "resolved" : "unresolved"}`,
    `New blocking findings: ${receipt.proof.blockingNewFindings.length}`,
    `Oath: ${receipt.verification.report.decision}`,
    `Decision: ${receipt.decision}`,
    `Patch: ${receipt.changes.patchPath}`,
    "",
  ].join("\n");
}

export async function readRepairReceipt(path: string): Promise<RepairReceipt> {
  return JSON.parse(await readFile(path, "utf8")) as RepairReceipt;
}

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

import { inspectRepository } from "../detector/inspect.js";
import type { RepositoryFinding } from "../detector/types.js";
import { parseOath } from "../domain/oath.js";
import {
  detectInfrastructureAsCode,
  evaluateCostChange,
  normalizeInfracostOutput,
  type CostAnalysisEvidence,
  type InfracostScanner,
} from "../integrations/infracost.js";
import { runMaintenance } from "../maintainer/run.js";
import type { TrustedRunner } from "../runner/types.js";
import { assertSafeRepositoryWorkspace } from "../runner/workspace.js";
import {
  isolatedDependencyCommandRunner,
  prepareNpmRepairWorkspace,
} from "../runner/npm.js";
import { compareRepairProof, repairDecision } from "./proof.js";
import { parsePorcelainV1Z } from "./git-status.js";
import {
  receiptSignerFromEnvironment,
  signReceipt,
  type ReceiptSigner,
} from "./signature.js";
import type { RepairAgent, RepairReceipt } from "./types.js";

const execFileAsync = promisify(execFile);

interface RepairOptions {
  repositoryPath: string;
  agent: RepairAgent;
  findingId?: string;
  now?: () => Date;
  runner?: TrustedRunner;
  preparationRunner?: TrustedRunner;
  signer?: ReceiptSigner;
  includeDependencyChecks?: boolean;
  allowMajorPackageUpdates?: boolean;
  costScanner?: InfracostScanner;
  finding?: RepositoryFinding;
}

async function costPolicyFor(repositoryPath: string) {
  try {
    return parseOath(await readFile(join(repositoryPath, "software-oath.yml"), "utf8")).cost;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function decisionWithCost(
  decision: RepairReceipt["decision"],
  cost?: CostAnalysisEvidence,
): RepairReceipt["decision"] {
  if (decision === "blocked" || cost?.status === "blocked") return "blocked";
  if (decision === "review_required" || cost?.status === "review_required") {
    return "review_required";
  }
  return decision;
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
  const ecosystemDetail = finding.dependency?.ecosystem
    ? `\nEcosystem: ${finding.dependency.ecosystem}`
    : "";
  const locationDetail = finding.evidence.path
    ? `\nTarget Location: ${finding.evidence.path}${finding.evidence.line ? `:${finding.evidence.line}` : ""}`
    : "";

  return `You are performing one bounded Software Oath maintenance repair.

Problem:
${finding.title}
${finding.summary}${ecosystemDetail}${locationDetail}

Evidence & Details:
${finding.evidence.detail || JSON.stringify(finding.evidence, null, 2)}

Repair objective:
${finding.repair.objective}

Hard boundaries:
- You may modify only these allowed paths: ${finding.repair.allowedPaths.join(", ") || "(all tracked repository files allowed for this finding)"}
- Do not modify software-oath.yml or weaken any test, rule, or validation command.
- Do not commit, push, open a pull request, or access files outside this workspace.
- Make the smallest behavior-preserving change that resolves the stated problem across all target files.
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

export function isProtectedRepairPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return (
    normalized === "software-oath.yml" ||
    normalized === "CODEOWNERS" ||
    normalized === ".github/CODEOWNERS" ||
    normalized === ".software-oath" ||
    normalized.startsWith(".software-oath/") ||
    normalized === ".github/workflows" ||
    normalized.startsWith(".github/workflows/")
  );
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
  const inspection = await inspectRepository({
    repositoryPath,
    now,
    includeDependencyChecks: options.includeDependencyChecks,
    allowMajorPackageUpdates: options.allowMajorPackageUpdates,
    dependencyCommandRunner: options.preparationRunner
      ? isolatedDependencyCommandRunner(repositoryPath, options.preparationRunner)
      : undefined,
    runner: options.runner,
  });
  const finding = options.finding ?? chooseFinding(inspection.findings, options.findingId);
  const beforeInspection = options.finding
    ? {
        ...inspection,
        summary: {
          ...inspection.summary,
          total: inspection.summary.total + 1,
          medium: inspection.summary.medium + 1,
          automaticCandidates: inspection.summary.automaticCandidates + 1,
        },
        findings: [...inspection.findings, options.finding],
      }
    : inspection;
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
      finding,
    });
    if (options.preparationRunner) {
      await prepareNpmRepairWorkspace({
        workspacePath,
        finding,
        runner: options.preparationRunner,
      });
    }
    const changedOutput = await gitRaw(workspacePath, [
      "status",
      "--porcelain=v1",
      "-z",
    ]);
    const { changedPaths: changedFiles, untrackedPaths } =
      parsePorcelainV1Z(changedOutput);
    const withinAllowedScope =
      changedFiles.length > 0 &&
      changedFiles.every(
        (path) =>
          !isProtectedRepairPath(path) &&
          isAllowed(path, finding.repair.allowedPaths),
      );
    if (untrackedPaths.length > 0) {
      await execFileAsync("git", ["add", "--intent-to-add", "--", ...untrackedPaths], {
        cwd: workspacePath,
      });
    }
    if (changedFiles.length > 0) {
      await assertSafeRepositoryWorkspace(workspacePath);
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
      runner: options.runner,
    });
    const afterInspection = await inspectRepository({
      repositoryPath: workspacePath,
      now,
      maintenanceReceipt: verification,
      includeDependencyChecks: options.includeDependencyChecks,
      allowMajorPackageUpdates: options.allowMajorPackageUpdates,
      dependencyCommandRunner: options.preparationRunner
        ? isolatedDependencyCommandRunner(workspacePath, options.preparationRunner)
        : undefined,
      runner: options.runner,
    });
    const proof = compareRepairProof(beforeInspection, afterInspection, finding);
    const verificationDecision = repairDecision({
      withinAllowedScope,
      hasPatch: Boolean(patch),
      verificationDecision: verification.report.decision,
      proof,
    });

    await mkdir(artifactDirectory, { recursive: true });
    const patchPath = join(artifactDirectory, "repair.patch");
    await writeFile(patchPath, patch, "utf8");
    const costPolicy = await costPolicyFor(repositoryPath);
    let cost: CostAnalysisEvidence | undefined;
    if (costPolicy?.enabled) {
      const detectedFiles = await detectInfrastructureAsCode(workspacePath);
      if (!detectedFiles.length) {
        cost = evaluateCostChange({ policy: costPolicy, detectedFiles });
      } else if (!options.costScanner) {
        cost = evaluateCostChange({
          policy: costPolicy,
          detectedFiles,
          error: "Infracost scanning is enabled by policy, but no isolated cost scanner is configured.",
        });
      } else {
        try {
          const [baselineScan, proposedScan] = await Promise.all([
            options.costScanner.scan(repositoryPath, costPolicy.currency),
            options.costScanner.scan(workspacePath, costPolicy.currency),
          ]);
          const baselinePath = join(artifactDirectory, "infracost-baseline.json");
          const proposedPath = join(artifactDirectory, "infracost-proposed.json");
          await Promise.all([
            writeFile(baselinePath, baselineScan.output, "utf8"),
            writeFile(proposedPath, proposedScan.output, "utf8"),
          ]);
          cost = evaluateCostChange({
            policy: costPolicy,
            detectedFiles,
            baseline: normalizeInfracostOutput(baselineScan.output, costPolicy.currency),
            proposed: normalizeInfracostOutput(proposedScan.output, costPolicy.currency),
            baselineScan,
            proposedScan,
            baselinePath,
            proposedPath,
          });
        } catch (error) {
          cost = evaluateCostChange({
            policy: costPolicy,
            detectedFiles,
            error: error instanceof Error ? error.message : "Infracost analysis failed.",
          });
        }
      }
    }
    const decision = decisionWithCost(verificationDecision, cost);
    const unsignedReceipt: Omit<RepairReceipt, "signature"> = {
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
      cost,
      decision,
      generatedAt: now().toISOString(),
    };
    const receipt = signReceipt(
      unsignedReceipt,
      options.signer ?? receiptSignerFromEnvironment(),
      now(),
    );
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

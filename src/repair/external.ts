import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { inspectRepository } from "../detector/inspect";
import { parseOath } from "../domain/oath";
import {
  detectInfrastructureAsCode,
  evaluateCostChange,
} from "../integrations/infracost";
import type {
  InspectionReport,
  RepositoryFinding,
} from "../detector/types";
import { runMaintenance } from "../maintainer/run";
import { compareRepairProof, repairDecision } from "./proof";
import { buildRepairPrompt } from "./run";
import {
  receiptSignerFromEnvironment,
  signReceipt,
  type ReceiptSigner,
} from "./signature";
import type { RepairReceipt } from "./types";

const execFileAsync = promisify(execFile);

export interface ExternalRepairContext {
  version: 1;
  id: string;
  repositoryPath: string;
  baseCommit: string;
  finding: RepositoryFinding;
  inspection: InspectionReport["summary"];
  inspectionFindings: RepositoryFinding[];
  generatedAt: string;
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
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

function idFor(date: Date): string {
  return `REPAIR-${date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function allowed(path: string, paths: string[]): boolean {
  return paths.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

export async function prepareExternalRepair(options: {
  repositoryPath: string;
  outputDirectory: string;
  now?: () => Date;
}): Promise<
  | { status: "no_candidate"; inspection: InspectionReport }
  | {
      status: "prepared";
      context: ExternalRepairContext;
      contextPath: string;
      promptPath: string;
    }
> {
  const repositoryPath = resolve(options.repositoryPath);
  const outputDirectory = resolve(options.outputDirectory);
  const now = options.now ?? (() => new Date());
  const inspection = await inspectRepository({ repositoryPath, now });
  const finding = inspection.findings.find(
    ({ repair }) => repair.automaticCandidate,
  );
  if (!finding) return { status: "no_candidate", inspection };

  const generatedAt = now();
  const context: ExternalRepairContext = {
    version: 1,
    id: idFor(generatedAt),
    repositoryPath,
    baseCommit: await git(repositoryPath, ["rev-parse", "HEAD"]),
    finding,
    inspection: inspection.summary,
    inspectionFindings: inspection.findings,
    generatedAt: generatedAt.toISOString(),
  };
  await mkdir(outputDirectory, { recursive: true });
  const contextPath = join(outputDirectory, "context.json");
  const promptPath = join(outputDirectory, "prompt.md");
  await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  await writeFile(promptPath, buildRepairPrompt(finding), "utf8");
  return { status: "prepared", context, contextPath, promptPath };
}

export async function verifyExternalRepair(options: {
  repositoryPath: string;
  contextPath: string;
  outputDirectory: string;
  agentOutputPath?: string;
  now?: () => Date;
  signer?: ReceiptSigner;
}): Promise<RepairReceipt> {
  const repositoryPath = resolve(options.repositoryPath);
  const outputDirectory = resolve(options.outputDirectory);
  const context = JSON.parse(
    await readFile(options.contextPath, "utf8"),
  ) as ExternalRepairContext;
  const head = await git(repositoryPath, ["rev-parse", "HEAD"]);
  if (head !== context.baseCommit) {
    throw new Error("The checkout commit changed during the repair job.");
  }
  const status = await gitRaw(repositoryPath, [
    "status",
    "--porcelain=v1",
    "-z",
  ]);
  const files = status
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .sort();
  const withinAllowedScope =
    files.length > 0 &&
    files.every((path) => allowed(path, context.finding.repair.allowedPaths));
  if (files.length > 0) {
    await execFileAsync("git", ["add", "--intent-to-add", "--", ...files], {
      cwd: repositoryPath,
    });
  }
  const patch = await gitRaw(repositoryPath, [
    "diff",
    "--binary",
    "--no-ext-diff",
  ]);
  const patchSha256 = createHash("sha256").update(patch).digest("hex");
  const now = options.now ?? (() => new Date());
  const verification = await runMaintenance({
    repositoryPath,
    writeReceipt: false,
    now,
    incident: {
      title: context.finding.title,
      source: context.finding.detector,
      detectedAt: context.generatedAt,
    },
    repair: {
      summary: "External Codex Action completed the bounded repair attempt.",
      files,
      diff: patch.split("\n"),
    },
  });
  const afterInspection = await inspectRepository({
    repositoryPath,
    now,
    maintenanceReceipt: verification,
  });
  const beforeInspection: InspectionReport = {
    version: 1,
    repositoryPath,
    generatedAt: context.generatedAt,
    summary: context.inspection,
    findings: context.inspectionFindings,
  };
  const proof = compareRepairProof(
    beforeInspection,
    afterInspection,
    context.finding,
  );
  const verificationDecision = repairDecision({
    withinAllowedScope,
    hasPatch: Boolean(patch),
    verificationDecision: verification.report.decision,
    proof,
  });
  const costPolicy = parseOath(
    await readFile(join(repositoryPath, "software-oath.yml"), "utf8"),
  ).cost;
  const cost = costPolicy?.enabled
    ? evaluateCostChange({
        policy: costPolicy,
        detectedFiles: await detectInfrastructureAsCode(repositoryPath),
        error:
          "Cost-enabled IaC requires the connected isolated Infracost runner; external CI verification cannot bypass this policy.",
      })
    : undefined;
  const decision =
    verificationDecision === "blocked" || cost?.status === "blocked"
      ? "blocked"
      : verificationDecision === "review_required" || cost?.status === "review_required"
        ? "review_required"
        : verificationDecision;
  await mkdir(outputDirectory, { recursive: true });
  const patchPath = join(outputDirectory, "repair.patch");
  await writeFile(patchPath, patch, "utf8");
  const agentOutput = options.agentOutputPath
    ? await readFile(options.agentOutputPath, "utf8").catch(() => "")
    : "";
  const unsignedReceipt: Omit<RepairReceipt, "signature"> = {
    version: 1,
    id: context.id,
    repositoryPath,
    baseCommit: context.baseCommit,
    finding: context.finding,
    inspection: context.inspection,
    agent: {
      name: "openai/codex-action",
      summary: "Codex Action completed the bounded repair attempt.",
      output: agentOutput,
    },
    changes: {
      files,
      withinAllowedScope,
      patchPath,
      patchSha256,
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
    join(outputDirectory, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  return receipt;
}

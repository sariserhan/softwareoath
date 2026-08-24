import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { runMaintenance } from "../maintainer/run";
import {
  verifyReceiptSignature,
  type TrustedReceiptKeys,
} from "./signature";
import type {
  RepairApplicationReceipt,
  RepairReceipt,
} from "./types";

const execFileAsync = promisify(execFile);

async function git(repositoryPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryPath,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

async function gitSoftwareOathRoot(repositoryPath: string): Promise<string> {
  return resolve(
    repositoryPath,
    await git(repositoryPath, ["rev-parse", "--git-common-dir"]),
    "software-oath",
  );
}

export async function resolveRepairReceipt(options: {
  repositoryPath: string;
  repairId?: string;
  receiptPath?: string;
  trustedKeys?: TrustedReceiptKeys;
}): Promise<{ receipt: RepairReceipt; receiptPath: string; patchPath: string }> {
  const repositoryPath = resolve(options.repositoryPath);
  let receiptPath: string;
  if (options.receiptPath) {
    receiptPath = resolve(options.receiptPath);
  } else {
    const repairsRoot = join(
      await gitSoftwareOathRoot(repositoryPath),
      "repairs",
    );
    const repairId =
      options.repairId && options.repairId !== "latest"
        ? options.repairId
        : (await readdir(repairsRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map(({ name }) => name)
            .sort()
            .at(-1);
    if (!repairId) throw new Error("No Software Oath repair receipts were found.");
    receiptPath = join(repairsRoot, repairId, "receipt.json");
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as RepairReceipt;
  verifyReceiptSignature(receipt, options.trustedKeys);
  const patchPath = join(dirname(receiptPath), "repair.patch");
  return { receipt, receiptPath, patchPath };
}

export async function formatRepairReview(options: {
  repositoryPath: string;
  repairId?: string;
  receiptPath?: string;
  trustedKeys?: TrustedReceiptKeys;
}): Promise<string> {
  const { receipt, patchPath } = await resolveRepairReceipt(options);
  const patch = await readFile(patchPath, "utf8");
  const evidence = receipt.verification.report.rules
    .flatMap((rule) =>
      rule.evidence.map(
        (record) =>
          `- **${rule.rule.title}:** ${record.status} — ${record.summary.split("\n")[0]}`,
      ),
    )
    .join("\n");
  return `# Software Oath repair review

**Repair:** ${receipt.id}  
**Decision:** ${receipt.decision}  
**Problem:** ${receipt.finding.title}  
**Agent:** ${receipt.agent.name}  
**Base commit:** ${receipt.baseCommit}  
**Scope:** ${receipt.changes.withinAllowedScope ? "valid" : "rejected"}

**Original problem:** ${receipt.proof?.selectedFindingResolved ? "resolved" : "unresolved"}

**New blocking findings:** ${receipt.proof?.blockingNewFindings.length ?? "unknown"}

## Repair objective

${receipt.finding.repair.objective}

## Changed files

${receipt.changes.files.map((path) => `- \`${path}\``).join("\n") || "- No files"}

## Verification evidence

${evidence || "- No evidence"}

## Cost analysis

${receipt.cost ? [
  `- Provider: ${receipt.cost.provider} ${receipt.cost.version}`,
  `- Status: ${receipt.cost.status}`,
  `- Baseline: ${receipt.cost.baselineMonthlyCost ?? "Unavailable"} ${receipt.cost.currency}`,
  `- Proposed: ${receipt.cost.proposedMonthlyCost ?? "Unavailable"} ${receipt.cost.currency}`,
  `- Change: ${receipt.cost.monthlyCostChange ?? "Unavailable"} ${receipt.cost.currency} (${receipt.cost.percentageChange ?? "Unavailable"}%)`,
  ...receipt.cost.reasons.map((reason) => `- ${reason}`),
].join("\n") : "- Cost analysis is not enabled for this repository."}

## Patch

\`\`\`diff
${patch.trimEnd()}
\`\`\`
`;
}

export async function applyRepair(options: {
  repositoryPath: string;
  repairId?: string;
  receiptPath?: string;
  branch?: string;
  approveReview?: boolean;
  now?: () => Date;
  trustedKeys?: TrustedReceiptKeys;
}): Promise<RepairApplicationReceipt> {
  const repositoryPath = resolve(options.repositoryPath);
  const { receipt, patchPath } = await resolveRepairReceipt(options);
  if (receipt.decision === "blocked") {
    throw new Error("Blocked repairs cannot be applied.");
  }
  if (receipt.decision === "review_required" && !options.approveReview) {
    throw new Error(
      "This repair requires human approval. Review it and pass --approve-review to apply.",
    );
  }
  if (!receipt.changes.withinAllowedScope) {
    throw new Error("The repair receipt reports out-of-scope changes.");
  }
  if (!receipt.proof?.selectedFindingResolved) {
    throw new Error(
      "The repair receipt does not prove that the original finding was resolved.",
    );
  }
  if (receipt.proof.blockingNewFindings.length > 0) {
    throw new Error("The repair introduced a new high or critical finding.");
  }
  const status = await git(repositoryPath, ["status", "--porcelain"]);
  if (status) throw new Error("The target working tree must be clean before applying.");
  const head = await git(repositoryPath, ["rev-parse", "HEAD"]);
  if (head !== receipt.baseCommit) {
    throw new Error(
      `The repair was verified against ${receipt.baseCommit}, but HEAD is ${head}. Re-run the repair on the current commit.`,
    );
  }

  const patch = await readFile(patchPath);
  const patchSha256 = createHash("sha256").update(patch).digest("hex");
  if (
    receipt.changes.patchSha256 &&
    receipt.changes.patchSha256 !== patchSha256
  ) {
    throw new Error("The repair patch does not match its evidence receipt.");
  }
  await execFileAsync("git", ["apply", "--check", patchPath], {
    cwd: repositoryPath,
  });
  const branch =
    options.branch ?? `software-oath/${receipt.id.toLowerCase()}`;
  if (await git(repositoryPath, ["branch", "--list", branch])) {
    throw new Error(`Branch ${branch} already exists.`);
  }
  await git(repositoryPath, ["switch", "-c", branch]);
  await execFileAsync("git", ["apply", patchPath], { cwd: repositoryPath });

  const now = options.now ?? (() => new Date());
  const verification = await runMaintenance({
    repositoryPath,
    writeReceipt: true,
    now,
    incident: receipt.verification.run.incident,
    repair: receipt.verification.run.repair,
  });
  const decision =
    verification.report.decision === "blocked"
      ? "blocked"
      : receipt.decision === "review_required"
        ? "review_required"
        : "ready";
  const application: RepairApplicationReceipt = {
    version: 1,
    repairId: receipt.id,
    repositoryPath,
    branch,
    baseCommit: receipt.baseCommit,
    patchSha256,
    verification,
    decision,
    appliedAt: now().toISOString(),
  };
  const applicationRoot = join(
    await gitSoftwareOathRoot(repositoryPath),
    "applications",
  );
  await mkdir(applicationRoot, { recursive: true });
  await writeFile(
    join(applicationRoot, `${receipt.id}.json`),
    `${JSON.stringify(application, null, 2)}\n`,
    "utf8",
  );
  return application;
}

export function formatApplicationResult(
  application: RepairApplicationReceipt,
): string {
  return [
    `Software Oath applied ${application.repairId}`,
    `Branch: ${application.branch}`,
    `Files are modified but not committed.`,
    `Verification: ${application.verification.report.decision}`,
    `Decision: ${application.decision}`,
    "",
  ].join("\n");
}

export function repairIdFromReceiptPath(path: string): string {
  return basename(dirname(path));
}

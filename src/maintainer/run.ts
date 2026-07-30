import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import { evaluateOath, parseOath } from "../domain/oath";
import type {
  EvidenceRecord,
  OathReport,
  RepairRun,
  SoftwareOath,
} from "../domain/types";
import { LocalTrustedRunner } from "../runner/local";
import type { TrustedRunner } from "../runner/types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface MaintenanceReceipt {
  version: 1;
  run: RepairRun;
  report: OathReport;
  execution: {
    repositoryPath: string;
    startedAt: string;
    completedAt: string;
    runner: string;
  };
}

export interface RunMaintenanceOptions {
  repositoryPath: string;
  oathPath?: string;
  writeReceipt?: boolean;
  now?: () => Date;
  incident?: RepairRun["incident"];
  repair?: RepairRun["repair"];
  runner?: TrustedRunner;
}

function runId(now: Date): string {
  return `RUN-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

async function gitValue(repositoryPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repositoryPath,
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function receiptRoot(repositoryPath: string): Promise<string> {
  const gitDirectory = await gitValue(repositoryPath, [
    "rev-parse",
    "--git-common-dir",
  ]);
  if (gitDirectory === "unknown") {
    throw new Error("Maintenance receipts require a Git repository.");
  }
  return resolve(repositoryPath, gitDirectory, "software-oath", "runs");
}

async function collectEvidence(
  oath: SoftwareOath,
  repositoryPath: string,
  runner: TrustedRunner,
): Promise<EvidenceRecord[]> {
  const records: EvidenceRecord[] = [];

  for (const rule of oath.rules) {
    for (const requirement of rule.evidence) {
      if (requirement.kind === "review") {
        records.push({
          ruleId: rule.id,
          kind: "review",
          status: "human_review",
          summary: "This promise explicitly requires human judgment.",
        });
        continue;
      }

      if (!requirement.command) {
        const path = requirement.path
          ? resolve(repositoryPath, requirement.path)
          : undefined;
        let exists = false;
        if (path) {
          try {
            await access(path);
            exists = true;
          } catch {
            exists = false;
          }
        }
        records.push({
          ruleId: rule.id,
          kind: requirement.kind,
          status: "human_review",
          summary: exists
            ? `Found ${requirement.path}, but no executable command was declared.`
            : `Cannot execute this check${requirement.path ? `; ${requirement.path} was not found` : ""}.`,
        });
        continue;
      }

      const result = await runner.execute({
        command: requirement.command,
        workspacePath: repositoryPath,
        timeoutMs: requirement.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      records.push({
        ruleId: rule.id,
        kind: requirement.kind,
        status: result.exitCode === 0 ? "passed" : "failed",
        summary:
          result.exitCode === 0
            ? "Declared check completed successfully."
            : `Declared check failed with exit code ${result.exitCode ?? "unknown"}.\n${result.output}`,
        command: requirement.command,
        durationMs: result.durationMs,
      });
    }
  }

  return records;
}

export async function runMaintenance(
  options: RunMaintenanceOptions,
): Promise<MaintenanceReceipt> {
  const repositoryPath = resolve(options.repositoryPath);
  const oathPath = resolve(
    repositoryPath,
    options.oathPath ?? "software-oath.yml",
  );
  const now = options.now ?? (() => new Date());
  const runner = options.runner ?? new LocalTrustedRunner();
  const started = now();
  const oath = parseOath(await readFile(oathPath, "utf8"));
  const [branch, commit, evidence] = await Promise.all([
    gitValue(repositoryPath, ["branch", "--show-current"]),
    gitValue(repositoryPath, ["rev-parse", "HEAD"]),
    collectEvidence(oath, repositoryPath, runner),
  ]);

  const run: RepairRun = {
    id: runId(started),
    incident:
      options.incident ??
      {
        title: "Scheduled repository maintenance",
        source: "software-oath-local",
        detectedAt: started.toISOString(),
      },
    repository: { branch: branch || "detached", commit },
    repair:
      options.repair ??
      {
        summary: "No repair was attempted; this run measured repository health.",
        files: [],
        diff: [],
      },
    evidence,
  };
  const completed = now();
  const receipt: MaintenanceReceipt = {
    version: 1,
    run,
    report: evaluateOath(oath, run, completed.toISOString()),
    execution: {
      repositoryPath,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      runner: runner.name,
    },
  };

  if (options.writeReceipt !== false) {
    const receiptDirectory = await receiptRoot(repositoryPath);
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(
      join(receiptDirectory, `${run.id}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
  }

  return receipt;
}

export function formatMaintenanceSummary(receipt: MaintenanceReceipt): string {
  const { report, run } = receipt;
  const lines = [
    `Software Oath · ${basename(receipt.execution.repositoryPath)}`,
    `Run: ${run.id}`,
    `Decision: ${report.decision}`,
    `Evidence: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.humanReview} review`,
    "",
  ];

  for (const result of report.rules) {
    lines.push(`[${result.status}] ${result.rule.title}`);
    for (const evidence of result.evidence) {
      lines.push(`  ${evidence.summary.split("\n")[0]}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

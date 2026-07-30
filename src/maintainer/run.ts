import { execFile, spawn } from "node:child_process";
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

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_LIMIT = 12_000;

export interface MaintenanceReceipt {
  version: 1;
  run: RepairRun;
  report: OathReport;
  execution: {
    repositoryPath: string;
    startedAt: string;
    completedAt: string;
  };
}

interface RunMaintenanceOptions {
  repositoryPath: string;
  oathPath?: string;
  writeReceipt?: boolean;
  now?: () => Date;
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

function boundedOutput(value: string): string {
  return value.length <= OUTPUT_LIMIT
    ? value
    : `[output truncated]\n${value.slice(-OUTPUT_LIMIT)}`;
}

async function execute(
  command: string,
  repositoryPath: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; output: string; durationMs: number }> {
  const startedAt = Date.now();

  return await new Promise((resolveResult) => {
    const child = spawn(command, {
      cwd: repositoryPath,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({
        exitCode: null,
        output: boundedOutput(`${output}\n${error.message}`.trim()),
        durationMs: Date.now() - startedAt,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveResult({
        exitCode,
        output: boundedOutput(
          `${output}${timedOut ? `\nTimed out after ${timeoutMs}ms.` : ""}`.trim(),
        ),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function collectEvidence(
  oath: SoftwareOath,
  repositoryPath: string,
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

      const result = await execute(
        requirement.command,
        repositoryPath,
        requirement.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
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
  const started = now();
  const oath = parseOath(await readFile(oathPath, "utf8"));
  const [branch, commit, evidence] = await Promise.all([
    gitValue(repositoryPath, ["branch", "--show-current"]),
    gitValue(repositoryPath, ["rev-parse", "HEAD"]),
    collectEvidence(oath, repositoryPath),
  ]);

  const run: RepairRun = {
    id: runId(started),
    incident: {
      title: "Scheduled repository maintenance",
      source: "software-oath-local",
      detectedAt: started.toISOString(),
    },
    repository: { branch: branch || "detached", commit },
    repair: {
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
    },
  };

  if (options.writeReceipt !== false) {
    const receiptDirectory = join(repositoryPath, ".softwareoath", "runs");
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

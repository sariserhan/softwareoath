import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";

import { inspectRepository } from "../detector/inspect";
import { CodexRepairAgent } from "../repair/codex";
import { runRepair } from "../repair/run";
import type { RepairAgent } from "../repair/types";
import type { TrustedRunner } from "../runner/types";
import type { ReplayReport, ReplaySpec } from "./types";

const execFileAsync = promisify(execFile);

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

export function parseReplaySpec(source: string): ReplaySpec {
  const raw = parse(source) as Record<string, unknown>;
  if (!raw || raw.version !== 1) throw new Error("replay version must be 1");
  return {
    version: 1,
    id: requiredString(raw.id, "id"),
    title: requiredString(raw.title, "title"),
    baseCommit: requiredString(raw.baseCommit, "baseCommit"),
    humanFixCommit: requiredString(raw.humanFixCommit, "humanFixCommit"),
    findingId:
      typeof raw.findingId === "string" ? raw.findingId : undefined,
    expectedChangedPaths: Array.isArray(raw.expectedChangedPaths)
      ? raw.expectedChangedPaths.map((path, index) =>
          requiredString(path, `expectedChangedPaths[${index}]`),
        )
      : undefined,
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

async function patchId(cwd: string, patch: string): Promise<string | null> {
  if (!patch.trim()) return null;
  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn("git", ["patch-id", "--stable"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveOutput(stdout.trim());
      else reject(new Error(`git patch-id failed: ${stderr.trim()}`));
    });
    child.stdin.end(patch);
  });
  return output.split(/\s+/)[0] || null;
}

export async function runReplay(options: {
  repositoryPath: string;
  specPath: string;
  agent?: RepairAgent;
  runner?: TrustedRunner;
  now?: () => Date;
}): Promise<ReplayReport> {
  const repositoryPath = resolve(options.repositoryPath);
  const spec = parseReplaySpec(await readFile(resolve(options.specPath), "utf8"));
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "software-oath-replay-"));
  const workspacePath = join(temporaryRoot, "workspace");
  let worktreeAdded = false;

  try {
    await git(repositoryPath, [
      "worktree",
      "add",
      "--detach",
      workspacePath,
      spec.baseCommit,
    ]);
    worktreeAdded = true;
    const before = await inspectRepository({ repositoryPath: workspacePath, now });
    const selected = spec.findingId
      ? before.findings.find(({ id }) => id === spec.findingId)
      : before.findings.find(({ repair }) => repair.automaticCandidate);
    if (!selected) {
      throw new Error("The historical commit did not reproduce the selected finding.");
    }

    const repair = await runRepair({
      repositoryPath: workspacePath,
      findingId: selected.id,
      agent: options.agent ?? new CodexRepairAgent(),
      runner: options.runner,
      now,
    });
    const aiPatch = await readFile(repair.changes.patchPath, "utf8");
    const humanPatch = await git(repositoryPath, [
      "diff",
      `${spec.humanFixCommit}^`,
      spec.humanFixCommit,
      "--",
      ...selected.repair.allowedPaths,
    ]);
    const humanChangedPaths = (
      await git(repositoryPath, [
        "diff",
        "--name-only",
        `${spec.humanFixCommit}^`,
        spec.humanFixCommit,
      ])
    )
      .split("\n")
      .filter(Boolean);
    const aiPatchId = await patchId(repositoryPath, aiPatch);
    const humanPatchId = await patchId(repositoryPath, humanPatch);
    const expectedPathsSatisfied = (spec.expectedChangedPaths ?? []).every(
      (path) => repair.changes.files.includes(path),
    );
    const completedAt = now();
    const report: ReplayReport = {
      version: 1,
      id: spec.id,
      title: spec.title,
      repositoryPath,
      baseCommit: spec.baseCommit,
      humanFixCommit: spec.humanFixCommit,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      reproductionConfirmed: true,
      repair,
      comparison: {
        aiPatchId,
        humanPatchId,
        exactPatchMatch: aiPatchId !== null && aiPatchId === humanPatchId,
        aiChangedPaths: repair.changes.files,
        humanChangedPaths,
        expectedPathsSatisfied,
      },
      verdict:
        repair.decision !== "blocked" && expectedPathsSatisfied
          ? "passed"
          : "failed",
    };
    const gitDirectory = resolve(
      repositoryPath,
      await git(repositoryPath, ["rev-parse", "--git-common-dir"]),
    );
    const outputDirectory = join(gitDirectory, "software-oath", "replays");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      join(outputDirectory, `${spec.id}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    return report;
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

export function formatReplayReport(report: ReplayReport): string {
  return [
    `Software Oath replay · ${basename(report.repositoryPath)}`,
    `Incident: ${report.title}`,
    `Reproduced: ${report.reproductionConfirmed ? "yes" : "no"}`,
    `Repair: ${report.repair.decision}`,
    `Original finding: ${report.repair.proof.selectedFindingResolved ? "resolved" : "unresolved"}`,
    `New blocking findings: ${report.repair.proof.blockingNewFindings.length}`,
    `Human patch match: ${report.comparison.exactPatchMatch ? "exact" : "behavioral comparison required"}`,
    `Verdict: ${report.verdict}`,
    "",
  ].join("\n");
}

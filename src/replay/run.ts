import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";

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
  const preparationRaw =
    raw.preparation &&
    typeof raw.preparation === "object" &&
    !Array.isArray(raw.preparation)
      ? (raw.preparation as Record<string, unknown>)
      : undefined;
  const stringArray = (value: unknown, name: string): string[] => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${name} must contain at least one path`);
    }
    return value.map((entry, index) =>
      requiredString(entry, `${name}[${index}]`),
    );
  };
  const severity = preparationRaw
    ? requiredString(preparationRaw.severity, "preparation.severity")
    : undefined;
  if (
    severity &&
    !["critical", "high", "medium", "low"].includes(severity)
  ) {
    throw new Error("preparation.severity is invalid");
  }
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
    preparationPatch:
      typeof raw.preparationPatch === "string"
        ? raw.preparationPatch
        : undefined,
    preparation: preparationRaw
      ? {
          evidencePaths: stringArray(
            preparationRaw.evidencePaths,
            "preparation.evidencePaths",
          ),
          command: requiredString(
            preparationRaw.command,
            "preparation.command",
          ),
          allowedPaths: stringArray(
            preparationRaw.allowedPaths,
            "preparation.allowedPaths",
          ),
          ruleId: requiredString(preparationRaw.ruleId, "preparation.ruleId"),
          ruleTitle: requiredString(
            preparationRaw.ruleTitle,
            "preparation.ruleTitle",
          ),
          ruleDescription: requiredString(
            preparationRaw.ruleDescription,
            "preparation.ruleDescription",
          ),
          severity: severity as NonNullable<
            ReplaySpec["preparation"]
          >["severity"],
        }
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

async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
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

async function applyPatch(cwd: string, patch: string): Promise<void> {
  await new Promise<void>((resolveApply, reject) => {
    const child = spawn("git", ["apply"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveApply();
      else reject(new Error(`git apply failed: ${stderr.trim()}`));
    });
    child.stdin.end(patch);
  });
}

export async function runReplay(options: {
  repositoryPath: string;
  specPath: string;
  agent?: RepairAgent;
  runner?: TrustedRunner;
  now?: () => Date;
}): Promise<ReplayReport> {
  const repositoryPath = resolve(options.repositoryPath);
  const specPath = resolve(options.specPath);
  const spec = parseReplaySpec(await readFile(specPath, "utf8"));
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
    if (spec.preparationPatch) {
      await execFileAsync(
        "git",
        ["apply", resolve(dirname(specPath), spec.preparationPatch)],
        { cwd: workspacePath },
      );
      await git(workspacePath, ["add", "--all"]);
      await execFileAsync(
        "git",
        ["commit", "-m", "Add historical incident reproduction fixture"],
        {
          cwd: workspacePath,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Software Oath Replay",
            GIT_AUTHOR_EMAIL: "replay@softwareoath.local",
            GIT_COMMITTER_NAME: "Software Oath Replay",
            GIT_COMMITTER_EMAIL: "replay@softwareoath.local",
          },
        },
      );
    } else if (spec.preparation) {
      const evidencePatch = await gitRaw(repositoryPath, [
        "diff",
        `${spec.humanFixCommit}^`,
        spec.humanFixCommit,
        "--",
        ...spec.preparation.evidencePaths,
      ]);
      if (!evidencePatch) {
        throw new Error("The human fix contains no declared evidence changes.");
      }
      await applyPatch(workspacePath, evidencePatch);
      await writeFile(
        join(workspacePath, "software-oath.yml"),
        stringify({
          version: 1,
          application: {
            name: spec.title,
            repository: "historical/replay",
            defaultBranch: "main",
          },
          approval: { requireHumanFor: [], allowAutomaticMerge: false },
          rules: [
            {
              id: spec.preparation.ruleId,
              title: spec.preparation.ruleTitle,
              description: spec.preparation.ruleDescription,
              severity: spec.preparation.severity,
              evidence: [
                {
                  kind: "command",
                  command: spec.preparation.command,
                  required: true,
                },
              ],
              repair: {
                allowedPaths: spec.preparation.allowedPaths,
                automaticCandidate: true,
              },
            },
          ],
        }),
        "utf8",
      );
      await git(workspacePath, ["add", "--all"]);
      await execFileAsync(
        "git",
        ["commit", "-m", "Add historical incident reproduction fixture"],
        {
          cwd: workspacePath,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Software Oath Replay",
            GIT_AUTHOR_EMAIL: "replay@softwareoath.local",
            GIT_COMMITTER_NAME: "Software Oath Replay",
            GIT_COMMITTER_EMAIL: "replay@softwareoath.local",
          },
        },
      );
    }
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

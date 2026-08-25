import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { inspectRepository } from "../detector/inspect.js";
import type { DependencyCommandRunner } from "../detector/dependencies.js";
import type { InspectionReport } from "../detector/types.js";
import type { TrustedRunner } from "../runner/types.js";
import { parseOath } from "../domain/oath.js";

const execFileAsync = promisify(execFile);
const MANIFESTS = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod",
  "pom.xml", "build.gradle", "Gemfile", "composer.json",
]);
const LOCKFILES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "Cargo.lock",
  "go.sum", "Gemfile.lock", "composer.lock",
]);

export interface RepositoryMemory {
  version: 1;
  repositoryPath: string;
  repository: string;
  branch: string;
  commit: string;
  previousCommit?: string;
  generatedAt: string;
  scanCount: number;
  inventory: {
    trackedFiles: number;
    extensions: Record<string, number>;
    topLevelAreas: string[];
    manifests: string[];
    lockfiles: string[];
    workflows: string[];
    tests: string[];
    architectureDocuments: string[];
  };
  validationCommands: string[];
  health: InspectionReport["summary"];
  capabilities?: NonNullable<InspectionReport["capabilities"]>;
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    title: string;
    path?: string;
    automaticCandidate: boolean;
  }>;
  history: Array<{
    commit: string;
    scannedAt: string;
    findings: number;
    critical: number;
    high: number;
  }>;
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryPath,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

function countExtensions(files: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = extname(file).toLowerCase() || "[none]";
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => right[1] - left[1]),
  );
}

async function previousMemory(path: string): Promise<RepositoryMemory | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RepositoryMemory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function scanRepositoryMemory(options: {
  repositoryPath: string;
  repositorySnapshot?: { files: string[]; commit: string; branch: string };
  memoryPath?: string;
  now?: () => Date;
  includeOathChecks?: boolean;
  includeDependencyChecks?: boolean;
  allowMajorPackageUpdates?: boolean;
  dependencyCommandRunner?: DependencyCommandRunner;
  runner?: TrustedRunner;
}): Promise<RepositoryMemory> {
  const repositoryPath = resolve(options.repositoryPath);
  const memoryPath = resolve(
    options.memoryPath ?? join(repositoryPath, ".software-oath", "memory.json"),
  );
  const now = options.now ?? (() => new Date());
  const files = options.repositorySnapshot
    ? [...options.repositorySnapshot.files].sort()
    : (await git(repositoryPath, ["ls-files", "-z"]))
        .split("\0")
        .filter(Boolean)
        .sort();
  const commit = options.repositorySnapshot?.commit ??
    await git(repositoryPath, ["rev-parse", "HEAD"]);
  const branch = options.repositorySnapshot?.branch ??
    ((await git(repositoryPath, ["branch", "--show-current"])) || "(detached)");
  const old = await previousMemory(memoryPath);
  const inspection = await inspectRepository({
    repositoryPath,
    now,
    includeOathChecks: options.includeOathChecks ?? true,
    includeDependencyChecks: options.includeDependencyChecks ?? true,
    allowMajorPackageUpdates: options.allowMajorPackageUpdates,
    dependencyCommandRunner: options.dependencyCommandRunner,
    runner: options.runner,
    trackedFiles: files,
  });
  const oath = parseOath(
    await readFile(join(repositoryPath, "software-oath.yml"), "utf8"),
  );
  const generatedAt = now().toISOString();
  const memory: RepositoryMemory = {
    version: 1,
    repositoryPath,
    repository: oath.application.repository,
    branch,
    commit,
    previousCommit: old?.commit,
    generatedAt,
    scanCount: (old?.scanCount ?? 0) + 1,
    inventory: {
      trackedFiles: files.length,
      extensions: countExtensions(files),
      topLevelAreas: [...new Set(files.map((file) => file.split("/")[0]))].sort(),
      manifests: files.filter((file) => MANIFESTS.has(file.split("/").at(-1)!)),
      lockfiles: files.filter((file) => LOCKFILES.has(file.split("/").at(-1)!)),
      workflows: files.filter((file) => file.startsWith(".github/workflows/")),
      tests: files.filter((file) =>
        /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(file),
      ),
      architectureDocuments: files.filter((file) =>
        /(^|\/)(architecture|design|adr|readme)(\.|\/)/i.test(file),
      ),
    },
    validationCommands: [
      ...new Set(
        oath.rules.flatMap((rule) =>
          rule.evidence.flatMap((evidence) =>
            evidence.command ? [evidence.command] : [],
          ),
        ),
      ),
    ],
    health: inspection.summary,
    capabilities: inspection.capabilities,
    findings: inspection.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      path: finding.evidence.path,
      automaticCandidate: finding.repair.automaticCandidate,
    })),
    history: [
      ...(old?.history ?? []),
      {
        commit,
        scannedAt: generatedAt,
        findings: inspection.summary.total,
        critical: inspection.summary.critical,
        high: inspection.summary.high,
      },
    ].slice(-52),
  };
  await mkdir(resolve(memoryPath, ".."), { recursive: true });
  const temporary = `${memoryPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  await rename(temporary, memoryPath);
  return memory;
}

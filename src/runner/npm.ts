import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import type { DependencyCommandRunner } from "../detector/dependencies.js";

import type { RepositoryFinding } from "../detector/types.js";
import type { TrustedRunner } from "./types.js";

const TRUSTED_REGISTRY = "registry.npmjs.org";

function resolvedUrls(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(resolvedUrls);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
    key === "resolved" && typeof entry === "string"
      ? [entry]
      : resolvedUrls(entry),
  );
}

export function assertTrustedNpmLockfile(source: string): void {
  const lockfile = JSON.parse(source) as unknown;
  for (const resolved of resolvedUrls(lockfile)) {
    let url: URL;
    try {
      url = new URL(resolved);
    } catch {
      throw new Error(`npm lockfile contains a non-URL resolved source: ${resolved}`);
    }
    if (url.protocol !== "https:" || url.hostname !== TRUSTED_REGISTRY) {
      throw new Error(
        `npm lockfile source is outside the trusted registry: ${resolved}`,
      );
    }
  }
}

export function isolatedDependencyCommandRunner(
  workspacePath: string,
  runner: TrustedRunner,
): DependencyCommandRunner {
  const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  return async (command, args, cwd) => {
    const directory = relative(workspacePath, cwd).replaceAll("\\", "/");
    if (directory === ".." || directory.startsWith("../") || directory.startsWith("/")) {
      throw new Error("Dependency command working directory escapes the workspace.");
    }
    const invocation = [command, ...args].map(quote).join(" ");
    const result = await runner.execute({
      command: directory ? `cd ${quote(directory)} && ${invocation}` : invocation,
      workspacePath,
      timeoutMs: 10 * 60 * 1_000,
    });
    return {
      stdout: result.output,
      stderr: result.exitCode === 0 ? "" : result.output,
      exitCode: result.exitCode ?? 1,
    };
  };
}

export async function prepareNpmWorkspace(options: {
  workspacePath: string;
  manifestPath?: string;
  lockfilePath?: string;
  runner: TrustedRunner;
  timeoutMs?: number;
}): Promise<void> {
  const manifestPath = options.manifestPath ?? "package.json";
  const lockfile = options.lockfilePath ?? "package-lock.json";
  const absoluteLockfile = join(options.workspacePath, lockfile);
  assertTrustedNpmLockfile(await readFile(absoluteLockfile, "utf8"));
  const prefix = dirname(manifestPath).replaceAll("\\", "/");
  if (prefix === ".." || prefix.startsWith("../") || prefix.startsWith("/")) {
    throw new Error("npm workspace path escapes the preparation workspace.");
  }
  const command = [
    "npm ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--registry=https://registry.npmjs.org",
    "--replace-registry-host=always",
    ...(prefix === "." ? [] : ["--prefix", JSON.stringify(prefix)]),
  ].join(" ");
  const result = await options.runner.execute({
    command,
    workspacePath: options.workspacePath,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Isolated npm dependency preparation failed.\n${result.output}`);
  }
}

export async function prepareNpmRepairWorkspace(options: {
  workspacePath: string;
  finding: RepositoryFinding;
  runner: TrustedRunner;
  timeoutMs?: number;
}): Promise<void> {
  const dependency = options.finding.dependency;
  if (dependency?.ecosystem !== "npm" || !dependency.lockfilePath) return;
  await prepareNpmWorkspace({
    workspacePath: options.workspacePath,
    manifestPath: dependency.manifestPath,
    lockfilePath: dependency.lockfilePath,
    runner: options.runner,
    timeoutMs: options.timeoutMs,
  });
}

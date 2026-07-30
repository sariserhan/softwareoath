import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { FindingSeverity, RepositoryFinding } from "./types";

const execFileAsync = promisify(execFile);

export interface DependencyCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type DependencyCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<DependencyCommandResult>;

export interface DependencyInspectionOptions {
  repositoryPath: string;
  files: string[];
  manifestPaths?: string[];
  allowMajorUpdates?: boolean;
  commandRunner?: DependencyCommandRunner;
}

export function npmCommand(args: string[]): { command: string; args: string[] } {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return { command: process.execPath, args: [npmCli, ...args] };
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args,
  };
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  cwd: string,
): Promise<DependencyCommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    if (failure.code === "ENOENT") {
      return { stdout: "", stderr: `${command} is not installed`, exitCode: 127 };
    }
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    };
  }
}

function parseJson<T>(source: string): T | undefined {
  if (!source.trim()) return undefined;
  try {
    return JSON.parse(source) as T;
  } catch {
    return undefined;
  }
}

function versionParts(version?: string): number[] | undefined {
  const match = version?.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : undefined;
}

export function dependencyUpdateKind(
  current?: string,
  target?: string,
): "patch" | "minor" | "major" | "unknown" {
  const from = versionParts(current);
  const to = versionParts(target);
  if (!from || !to) return "unknown";
  if (from[0] !== to[0]) return "major";
  if (from[1] !== to[1]) return "minor";
  return "patch";
}

function dependencyId(detector: string, manifest: string, packageName: string): string {
  return `${detector}-${manifest}-${packageName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface NpmOutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
  location?: string;
}

interface NpmAuditReport {
  vulnerabilities?: Record<string, {
    severity?: FindingSeverity | "moderate" | "info";
    isDirect?: boolean;
    via?: Array<string | { source?: number | string; title?: string; url?: string }>;
    fixAvailable?: boolean | { name?: string; version?: string; isSemVerMajor?: boolean };
  }>;
}

function npmSeverity(value?: string): FindingSeverity {
  if (value === "critical" || value === "high" || value === "low") return value;
  return "medium";
}

function npmAllowedPaths(manifestPath: string, files: string[]): string[] {
  const directory = dirname(manifestPath);
  const candidates = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ].map((name) => directory === "." ? name : join(directory, name).replaceAll("\\", "/"));
  return [manifestPath, ...candidates.filter((path) => files.includes(path))];
}

async function inspectNpmManifest(
  options: DependencyInspectionOptions,
  manifestPath: string,
): Promise<RepositoryFinding[]> {
  const runner = options.commandRunner ?? defaultCommandRunner;
  const cwd = join(options.repositoryPath, dirname(manifestPath));
  const allowedPaths = npmAllowedPaths(manifestPath, options.files);
  const lockfilePath = allowedPaths.find((path) => path !== manifestPath);
  const outdatedCommand = npmCommand(["outdated", "--json", "--long"]);
  const outdatedResult = await runner(
    outdatedCommand.command,
    outdatedCommand.args,
    cwd,
  );
  const outdated = parseJson<Record<string, NpmOutdatedEntry>>(outdatedResult.stdout);
  const findings: RepositoryFinding[] = [];
  if (outdatedResult.exitCode !== 0 && !outdated) {
    findings.push({
      id: dependencyId("npm-update-check-failure", manifestPath, "registry"),
      detector: "npm-update-check-failure",
      category: "dependencies",
      severity: "low",
      title: "npm package-update check could not complete",
      summary: "Software Oath could not obtain structured outdated-package data.",
      evidence: {
        path: manifestPath,
        detail: outdatedResult.stderr.trim().slice(0, 500) || `npm exited with ${outdatedResult.exitCode}.`,
      },
      repair: {
        objective: "Restore npm registry access and rerun the dependency scan.",
        allowedPaths: [],
        automaticCandidate: false,
      },
    });
  }

  for (const [packageName, entry] of Object.entries(outdated ?? {})) {
    const targetVersion = entry.wanted;
    if (!entry.current || !targetVersion || entry.current === targetVersion) continue;
    const updateKind = dependencyUpdateKind(entry.current, targetVersion);
    const automaticCandidate =
      Boolean(lockfilePath) &&
      (updateKind !== "major" || options.allowMajorUpdates === true);
    findings.push({
      id: dependencyId("npm-outdated", manifestPath, packageName),
      detector: "npm-outdated",
      category: "dependencies",
      severity: updateKind === "major" ? "medium" : "low",
      title: `${packageName} has a conservative npm update`,
      summary: `${packageName} can move from ${entry.current} to ${targetVersion} within npm's wanted range${entry.latest && entry.latest !== targetVersion ? `; latest is ${entry.latest}` : ""}.`,
      evidence: {
        path: manifestPath,
        detail: `npm outdated reported current=${entry.current}, wanted=${targetVersion}, latest=${entry.latest ?? "unknown"}.`,
      },
      repair: {
        objective: `Update ${packageName} to ${targetVersion} without running lifecycle scripts or changing unrelated dependencies.`,
        allowedPaths,
        automaticCandidate,
      },
      dependency: {
        ecosystem: "npm",
        packageName,
        currentVersion: entry.current,
        targetVersion,
        latestVersion: entry.latest,
        manifestPath,
        lockfilePath,
        updateKind,
      },
    });
  }

  const auditCommand = npmCommand(["audit", "--json", "--omit=dev"]);
  const auditResult = await runner(auditCommand.command, auditCommand.args, cwd);
  const audit = parseJson<NpmAuditReport>(auditResult.stdout);
  if (auditResult.exitCode !== 0 && !audit) {
    findings.push({
      id: dependencyId("npm-advisory-check-failure", manifestPath, "registry"),
      detector: "npm-advisory-check-failure",
      category: "security",
      severity: "medium",
      title: "npm security-advisory check could not complete",
      summary: "Software Oath could not obtain a structured npm audit report.",
      evidence: {
        path: manifestPath,
        detail: auditResult.stderr.trim().slice(0, 500) || `npm exited with ${auditResult.exitCode}.`,
      },
      repair: {
        objective: "Restore npm registry access and rerun the security scan.",
        allowedPaths: [],
        automaticCandidate: false,
      },
    });
  }
  for (const [packageName, vulnerability] of Object.entries(audit?.vulnerabilities ?? {})) {
    const fix = typeof vulnerability.fixAvailable === "object"
      ? vulnerability.fixAvailable
      : undefined;
    const targetVersion = fix?.version;
    const updateKind = dependencyUpdateKind(
      outdated?.[packageName]?.current,
      targetVersion,
    );
    const advisoryIds = (vulnerability.via ?? []).flatMap((item) =>
      typeof item === "object" && item.source !== undefined
        ? [String(item.source)]
        : [],
    );
    const automaticCandidate =
      vulnerability.isDirect === true &&
      Boolean(targetVersion && lockfilePath) &&
      (fix?.isSemVerMajor !== true || options.allowMajorUpdates === true);
    findings.push({
      id: dependencyId("npm-security-advisory", manifestPath, packageName),
      detector: "npm-security-advisory",
      category: "security",
      severity: npmSeverity(vulnerability.severity),
      title: `${packageName} is affected by an npm security advisory`,
      summary: targetVersion
        ? `npm recommends ${targetVersion}${fix?.isSemVerMajor ? " with a major-version change" : ""}.`
        : "npm reports no deterministic direct-package fix.",
      evidence: {
        path: manifestPath,
        detail: `npm audit reported ${vulnerability.severity ?? "unknown"} severity${advisoryIds.length ? ` (${advisoryIds.join(", ")})` : ""}.`,
      },
      repair: {
        objective: targetVersion
          ? `Update ${packageName} to the audited fixed version ${targetVersion} without running lifecycle scripts.`
          : `Review the ${packageName} advisory and its dependency path; no safe automatic target was reported.`,
        allowedPaths,
        automaticCandidate,
      },
      dependency: {
        ecosystem: "npm",
        packageName,
        currentVersion: outdated?.[packageName]?.current,
        targetVersion,
        latestVersion: outdated?.[packageName]?.latest,
        manifestPath,
        lockfilePath,
        updateKind: fix?.isSemVerMajor ? "major" : updateKind,
        advisoryIds,
      },
    });
  }
  return findings;
}

export async function inspectDependencies(
  options: DependencyInspectionOptions,
): Promise<{ findings: RepositoryFinding[] }> {
  const npmManifests =
    options.manifestPaths ??
    options.files.filter((path) => path === "package.json");
  return {
    findings: (
      await Promise.all(
        npmManifests.map((manifest) => inspectNpmManifest(options, manifest)),
      )
    ).flat(),
  };
}

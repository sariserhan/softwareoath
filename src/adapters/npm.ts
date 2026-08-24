import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  inspectDependencies,
  npmCommand,
  type DependencyCommandRunner,
} from "../detector/dependencies";
import type { RepositoryAdapter } from "./types";

const execFileAsync = promisify(execFile);

export type AdapterUpdateExecutor = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

async function executeUpdate(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync(command, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
}

export function createNpmAdapter(options: {
  commandRunner?: DependencyCommandRunner;
  updateExecutor?: AdapterUpdateExecutor;
} = {}): RepositoryAdapter {
  return {
    id: "npm",
    ecosystem: "npm",
    support: "active",
    manifestBasenames: ["package.json"],
    lockfileBasenames: [
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ],
    toolchainBasenames: [".nvmrc", ".node-version"],
    matchesWorkspace({ workspacePath, files }) {
      const prefix = workspacePath === "." ? "" : `${workspacePath}/`;
      const has = (name: string) => files.includes(`${prefix}${name}`);
      return (
        has("package-lock.json") ||
        has("npm-shrinkwrap.json") ||
        !["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].some(has)
      );
    },
    capabilities: [
      "dependency-updates",
      "security-advisories",
      "deterministic-repair",
    ],
    execution: {
      network: "package-registry",
      installsApplicationDependencies: false,
      runsLifecycleScripts: false,
    },
    async analyze(context) {
      return (
        await inspectDependencies({
          repositoryPath: context.repositoryPath,
          files: context.files,
          allowMajorUpdates: context.allowMajorPackageUpdates,
          commandRunner: options.commandRunner,
          manifestPaths: context.workspace.manifests,
        })
      ).findings;
    },
    async repair({ workspacePath, finding }) {
      const dependency = finding.dependency;
      if (
        dependency?.ecosystem !== "npm" ||
        !dependency.targetVersion ||
        !dependency.lockfilePath
      ) {
        throw new Error("The selected finding is not an executable npm repair.");
      }
      if (
        !/^(?:@[-a-z0-9_.]+\/)?[-a-z0-9_.]+$/i.test(dependency.packageName) ||
        !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
          dependency.targetVersion,
        )
      ) {
        throw new Error("The npm package or target version is not safe to execute.");
      }
      if (
        dependency.updateKind === "major" &&
        finding.repair.automaticCandidate !== true
      ) {
        throw new Error("A major dependency update was not authorized by repository policy.");
      }
      const cwd = join(workspacePath, dirname(dependency.manifestPath));
      const manifestPath = join(workspacePath, dependency.manifestPath);
      const manifestBefore = await readFile(manifestPath, "utf8");
      const invocation = npmCommand([
        "update",
        dependency.packageName,
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ]);
      const { stdout, stderr } = await (
        options.updateExecutor ?? executeUpdate
      )(invocation.command, invocation.args, cwd);
      if (await readFile(manifestPath, "utf8") !== manifestBefore) {
        throw new Error("The npm lockfile-only repair modified package.json.");
      }
      return {
        summary: `Updated ${dependency.packageName} to ${dependency.targetVersion} using npm's lockfile-only mode with lifecycle scripts disabled.`,
        output: `${stdout}${stderr}`.slice(-20_000),
      };
    },
  };
}

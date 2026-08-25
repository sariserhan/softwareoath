import { dirname, join } from "node:path";
import type { DependencyCommandRunner } from "../detector/dependencies.js";
import type { RepositoryFinding } from "../detector/types.js";
import type { RepositoryAdapter } from "./types.js";

interface AuditAdapterOptions {
  id: string;
  manifests: string[];
  manifestPatterns?: RegExp[];
  lockfiles: string[];
  toolchains?: string[];
  command: string;
  args: string[];
  commandRunner?: DependencyCommandRunner;
  requiredLockfiles?: string[];
}
function findingId(id: string, path: string) {
  return ("adapter-" + id + "-" + path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
function vulnerabilityCount(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((sum, item) => sum + vulnerabilityCount(item), 0);
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.vulnerabilities))
    return record.vulnerabilities.length;
  if (record.vulnerabilities && typeof record.vulnerabilities === "object")
    return Object.keys(record.vulnerabilities).length;
  if (record.Finding || record.OSV || record.advisory) return 1;
  return Object.values(record).reduce<number>(
    (sum, item) => sum + vulnerabilityCount(item),
    0,
  );
}
function parseStructuredOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    const records = output
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      });
    return records.length > 0 && records.every((record) => record !== undefined)
      ? records
      : undefined;
  }
}

export function createAuditAdapter(
  options: AuditAdapterOptions,
): RepositoryAdapter {
  return {
    id: options.id,
    ecosystem: options.id,
    support: "active",
    manifestBasenames: options.manifests,
    manifestPatterns: options.manifestPatterns,
    lockfileBasenames: options.lockfiles,
    toolchainBasenames: options.toolchains ?? [],
    capabilities: ["security-advisories"],
    matchesWorkspace: options.requiredLockfiles
      ? ({ workspacePath, files }) =>
          options.requiredLockfiles!.some((name) =>
            files.includes(
              (workspacePath === "." ? "" : workspacePath + "/") + name,
            ),
          )
      : undefined,
    execution: {
      network: "package-registry",
      installsApplicationDependencies: false,
      runsLifecycleScripts: false,
    },
    async analyze(context) {
      const runner = options.commandRunner;
      const manifest = context.workspace.manifests[0];
      if (!runner)
        return [
          {
            id: findingId(options.id, manifest),
            detector: options.id + "-advisory-tool-unavailable",
            category: "security",
            severity: "low",
            title:
              options.id + " advisory scan requires an isolated command runner",
            summary:
              "The active " +
              options.id +
              " adapter could not execute its structured advisory tool.",
            evidence: {
              path: manifest,
              detail: "Configure the isolated dependency command runner.",
            },
            repair: {
              objective:
                "Configure and rerun the " + options.id + " advisory scanner.",
              allowedPaths: [],
              automaticCandidate: false,
            },
          } satisfies RepositoryFinding,
        ];
      const cwd = join(context.repositoryPath, dirname(manifest));
      const result = await runner(options.command, options.args, cwd);
      const parsed = parseStructuredOutput(result.stdout);
      if (!parsed) {
        return [
          {
            id: findingId(options.id, manifest),
            detector: options.id + "-advisory-check-failure",
            category: "security",
            severity: "low",
            title: options.id + " advisory check could not complete",
            summary:
              "Software Oath could not obtain structured " +
              options.id +
              " advisory data.",
            evidence: {
              path: manifest,
              detail: (
                result.stderr ||
                options.command + " exited with " + result.exitCode
              ).slice(0, 500),
            },
            repair: {
              objective:
                "Restore " +
                options.command +
                " in the isolated runner and rerun.",
              allowedPaths: [],
              automaticCandidate: false,
            },
          },
        ];
      }
      const count = vulnerabilityCount(parsed);
      return count
        ? [
            {
              id: findingId(options.id, manifest + "-vulnerabilities"),
              detector: options.id + "-security-advisory",
              category: "security",
              severity: "high",
              title: options.id + " dependencies have reported vulnerabilities",
              summary:
                "The native " +
                options.id +
                " advisory tool reported " +
                count +
                " vulnerability record(s).",
              evidence: {
                path: manifest,
                detail:
                  "Structured advisory output reported " +
                  count +
                  " record(s); raw output is not persisted.",
              },
              repair: {
                objective:
                  "Review native advisory details, update affected dependencies, and rerun verification.",
                allowedPaths: [
                  ...context.workspace.manifests,
                  ...context.workspace.lockfiles,
                ],
                automaticCandidate: false,
              },
            },
          ]
        : [];
    },
  };
}

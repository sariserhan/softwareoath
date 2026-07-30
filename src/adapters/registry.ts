import type { RepositoryFinding } from "../detector/types";
import type { DependencyCommandRunner } from "../detector/dependencies";
import {
  createNpmAdapter,
  type AdapterUpdateExecutor,
} from "./npm";
import { buildCapabilityPlan } from "./planner";
import type { RepositoryAdapter, RepositoryCapabilityPlan } from "./types";

function plannedAdapter(options: {
  id: string;
  ecosystem: string;
  manifests: string[];
  lockfiles: string[];
  toolchains?: string[];
  manifestPatterns?: RegExp[];
  requiredLockfiles?: string[];
}): RepositoryAdapter {
  return {
    id: options.id,
    ecosystem: options.ecosystem,
    support: "planned",
    manifestBasenames: options.manifests,
    manifestPatterns: options.manifestPatterns,
    lockfileBasenames: options.lockfiles,
    toolchainBasenames: options.toolchains ?? [],
    capabilities: ["dependency-updates", "security-advisories"],
    execution: {
      network: "none",
      installsApplicationDependencies: false,
      runsLifecycleScripts: false,
    },
    matchesWorkspace: options.requiredLockfiles
      ? ({ workspacePath, files }) =>
          options.requiredLockfiles!.some((lockfile) =>
            files.includes(
              `${workspacePath === "." ? "" : `${workspacePath}/`}${lockfile}`,
            ),
          )
      : undefined,
  };
}

export function createAdapterRegistry(options: {
  dependencyCommandRunner?: DependencyCommandRunner;
  updateExecutor?: AdapterUpdateExecutor;
} = {}): RepositoryAdapter[] {
  return [
    createNpmAdapter({
      commandRunner: options.dependencyCommandRunner,
      updateExecutor: options.updateExecutor,
    }),
    plannedAdapter({
      id: "pnpm",
      ecosystem: "pnpm",
      manifests: ["package.json"],
      lockfiles: ["pnpm-lock.yaml"],
      toolchains: [".nvmrc", ".node-version"],
      requiredLockfiles: ["pnpm-lock.yaml"],
    }),
    plannedAdapter({
      id: "yarn",
      ecosystem: "yarn",
      manifests: ["package.json"],
      lockfiles: ["yarn.lock"],
      toolchains: [".nvmrc", ".node-version"],
      requiredLockfiles: ["yarn.lock"],
    }),
    plannedAdapter({
      id: "bun",
      ecosystem: "bun",
      manifests: ["package.json"],
      lockfiles: ["bun.lock", "bun.lockb"],
      toolchains: [".nvmrc", ".node-version"],
      requiredLockfiles: ["bun.lock", "bun.lockb"],
    }),
    plannedAdapter({
      id: "python",
      ecosystem: "python",
      manifests: ["pyproject.toml", "requirements.txt", "Pipfile"],
      lockfiles: ["poetry.lock", "Pipfile.lock", "uv.lock"],
      toolchains: [".python-version"],
      manifestPatterns: [/^requirements(?:[._-].+)?\.txt$/i],
    }),
    plannedAdapter({
      id: "rust",
      ecosystem: "rust",
      manifests: ["Cargo.toml"],
      lockfiles: ["Cargo.lock"],
      toolchains: ["rust-toolchain", "rust-toolchain.toml"],
    }),
    plannedAdapter({
      id: "go",
      ecosystem: "go",
      manifests: ["go.mod"],
      lockfiles: ["go.sum"],
    }),
    plannedAdapter({
      id: "maven",
      ecosystem: "maven",
      manifests: ["pom.xml"],
      lockfiles: [],
    }),
    plannedAdapter({
      id: "gradle",
      ecosystem: "gradle",
      manifests: ["build.gradle", "build.gradle.kts"],
      lockfiles: ["gradle.lockfile"],
    }),
    plannedAdapter({
      id: "ruby",
      ecosystem: "ruby",
      manifests: ["Gemfile"],
      lockfiles: ["Gemfile.lock"],
      toolchains: [".ruby-version"],
    }),
    plannedAdapter({
      id: "php",
      ecosystem: "php",
      manifests: ["composer.json"],
      lockfiles: ["composer.lock"],
    }),
    plannedAdapter({
      id: "dotnet",
      ecosystem: "dotnet",
      manifests: ["packages.config", "Directory.Packages.props"],
      manifestPatterns: [/\.(?:cs|fs|vb)proj$/i],
      lockfiles: ["packages.lock.json"],
      toolchains: ["global.json"],
    }),
  ];
}

function coverageGapFinding(
  gap: RepositoryCapabilityPlan["coverageGaps"][number],
): RepositoryFinding {
  const path = gap.manifests[0];
  return {
    id: `adapter-coverage-gap-${gap.adapterId}-${gap.workspacePath}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    detector: "adapter-coverage-gap",
    category: "maintainability",
    severity: "low",
    title: `${gap.ecosystem} dependency coverage is not active yet`,
    summary: `Software Oath recognized the ${gap.ecosystem} workspace but does not yet have active ${gap.missingCapabilities.join(" and ")} support.`,
    evidence: {
      path,
      detail: `Workspace ${gap.workspacePath}; manifests: ${gap.manifests.join(", ")}.`,
    },
    repair: {
      objective: `Add and validate the ${gap.adapterId} repository adapter before enabling automated maintenance for this workspace.`,
      allowedPaths: [],
      automaticCandidate: false,
    },
  };
}

export async function analyzeWithAdapters(options: {
  repositoryPath: string;
  files: string[];
  now?: () => Date;
  allowMajorPackageUpdates?: boolean;
  dependencyCommandRunner?: DependencyCommandRunner;
}): Promise<{
  plan: RepositoryCapabilityPlan;
  findings: RepositoryFinding[];
}> {
  const adapters = createAdapterRegistry({
    dependencyCommandRunner: options.dependencyCommandRunner,
  });
  const plan = buildCapabilityPlan({
    files: options.files,
    adapters,
    now: options.now,
  });
  const findings = await Promise.all(
    plan.workspaces
      .filter(({ support }) => support === "active")
      .map(async (workspace) => {
        const adapter = adapters.find(({ id }) => id === workspace.adapterId);
        if (!adapter?.analyze) return [];
        return await adapter.analyze({
          repositoryPath: options.repositoryPath,
          files: options.files,
          workspace,
          allowMajorPackageUpdates:
            options.allowMajorPackageUpdates === true,
        });
      }),
  );
  return {
    plan,
    findings: [
      ...findings.flat(),
      ...plan.coverageGaps.map(coverageGapFinding),
    ],
  };
}

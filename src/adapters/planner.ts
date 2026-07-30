import { basename, dirname } from "node:path";

import type {
  AdapterCapability,
  AdapterWorkspace,
  RepositoryAdapter,
  RepositoryCapabilityPlan,
} from "./types";

function normalizedDirectory(path: string): string {
  const directory = dirname(path).replaceAll("\\", "/");
  return directory === "." ? "." : directory;
}

function filesInWorkspace(
  files: string[],
  workspacePath: string,
  basenames: string[],
): string[] {
  return files.filter(
    (path) =>
      normalizedDirectory(path) === workspacePath &&
      basenames.includes(basename(path)),
  );
}

export function buildCapabilityPlan(options: {
  files: string[];
  adapters: RepositoryAdapter[];
  now?: () => Date;
}): RepositoryCapabilityPlan {
  const workspaces: AdapterWorkspace[] = [];
  for (const adapter of options.adapters) {
    const manifests = options.files.filter((path) =>
      adapter.manifestBasenames.includes(basename(path)) ||
      adapter.manifestPatterns?.some((pattern) => pattern.test(basename(path))),
    );
    const workspacePaths = [...new Set(manifests.map(normalizedDirectory))].sort();
    for (const workspacePath of workspacePaths) {
      const workspaceManifests = manifests.filter(
        (path) => normalizedDirectory(path) === workspacePath,
      );
      if (
        adapter.matchesWorkspace &&
        !adapter.matchesWorkspace({
          workspacePath,
          manifests: workspaceManifests,
          files: options.files,
        })
      ) {
        continue;
      }
      workspaces.push({
        path: workspacePath,
        adapterId: adapter.id,
        ecosystem: adapter.ecosystem,
        support: adapter.support,
        manifests: workspaceManifests.sort(),
        lockfiles: filesInWorkspace(
          options.files,
          workspacePath,
          adapter.lockfileBasenames,
        ).sort(),
        toolchainFiles: filesInWorkspace(
          options.files,
          workspacePath,
          adapter.toolchainBasenames,
        ).sort(),
        capabilities: adapter.capabilities.map((name) => ({
          name,
          status: adapter.support,
        })),
        execution: adapter.execution,
      });
    }
  }
  workspaces.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.adapterId.localeCompare(right.adapterId),
  );
  return {
    version: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    workspaces,
    activeAdapters: [
      ...new Set(
        workspaces
          .filter(({ support }) => support === "active")
          .map(({ adapterId }) => adapterId),
      ),
    ].sort(),
    coverageGaps: workspaces
      .filter(({ support }) => support === "planned")
      .map((workspace) => ({
        adapterId: workspace.adapterId,
        ecosystem: workspace.ecosystem,
        workspacePath: workspace.path,
        manifests: workspace.manifests,
        missingCapabilities: workspace.capabilities.map(
          ({ name }) => name,
        ) as AdapterCapability[],
      })),
  };
}

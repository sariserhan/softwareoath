import type { RepositoryFinding } from "../detector/types.js";

export type AdapterSupport = "active" | "planned";
export type AdapterCapability =
  | "dependency-updates"
  | "security-advisories"
  | "deterministic-repair";

export interface AdapterWorkspace {
  path: string;
  adapterId: string;
  ecosystem: string;
  support: AdapterSupport;
  manifests: string[];
  lockfiles: string[];
  toolchainFiles: string[];
  capabilities: Array<{
    name: AdapterCapability;
    status: AdapterSupport;
  }>;
  execution: {
    network: "none" | "package-registry";
    installsApplicationDependencies: boolean;
    runsLifecycleScripts: boolean;
  };
}

export interface RepositoryCapabilityPlan {
  version: 1;
  generatedAt: string;
  workspaces: AdapterWorkspace[];
  activeAdapters: string[];
  coverageGaps: Array<{
    adapterId: string;
    ecosystem: string;
    workspacePath: string;
    manifests: string[];
    missingCapabilities: AdapterCapability[];
  }>;
}

export interface AdapterAnalysisContext {
  repositoryPath: string;
  files: string[];
  workspace: AdapterWorkspace;
  allowMajorPackageUpdates: boolean;
}

export interface AdapterRepairContext {
  workspacePath: string;
  finding: RepositoryFinding;
}

export interface RepositoryAdapter {
  id: string;
  ecosystem: string;
  support: AdapterSupport;
  manifestBasenames: string[];
  manifestPatterns?: RegExp[];
  lockfileBasenames: string[];
  toolchainBasenames: string[];
  capabilities: AdapterCapability[];
  execution: AdapterWorkspace["execution"];
  matchesWorkspace?(context: {
    workspacePath: string;
    manifests: string[];
    files: string[];
  }): boolean;
  analyze?(context: AdapterAnalysisContext): Promise<RepositoryFinding[]>;
  repair?(context: AdapterRepairContext): Promise<{
    summary: string;
    output: string;
  }>;
}

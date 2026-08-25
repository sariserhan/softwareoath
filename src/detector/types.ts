import type { RepositoryCapabilityPlan } from "../adapters/types.js";

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingCategory =
  | "security"
  | "dependencies"
  | "maintainability";

export interface RepositoryFinding {
  id: string;
  detector: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  summary: string;
  evidence: {
    path?: string;
    line?: number;
    detail: string;
  };
  repair: {
    objective: string;
    allowedPaths: string[];
    automaticCandidate: boolean;
  };
  dependency?: {
    ecosystem: string;
    packageName: string;
    currentVersion?: string;
    targetVersion?: string;
    latestVersion?: string;
    manifestPath: string;
    lockfilePath?: string;
    updateKind?: "patch" | "minor" | "major" | "unknown";
    advisoryIds?: string[];
  };
}

export interface InspectionReport {
  version: 1;
  repositoryPath: string;
  generatedAt: string;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    automaticCandidates: number;
  };
  findings: RepositoryFinding[];
  capabilities?: RepositoryCapabilityPlan;
}

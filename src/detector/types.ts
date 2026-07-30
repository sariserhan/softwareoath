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
}

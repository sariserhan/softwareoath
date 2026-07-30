import type { InspectionReport, RepositoryFinding } from "../detector/types";
import type { MaintenanceReceipt } from "../maintainer/run";

export interface RepairAgent {
  name: string;
  repair(input: {
    workspacePath: string;
    prompt: string;
  }): Promise<{ summary: string; output: string }>;
}

export interface RepairReceipt {
  version: 1;
  id: string;
  repositoryPath: string;
  baseCommit: string;
  finding: RepositoryFinding;
  inspection: InspectionReport["summary"];
  agent: {
    name: string;
    summary: string;
    output: string;
  };
  changes: {
    files: string[];
    withinAllowedScope: boolean;
    patchPath: string;
  };
  verification: MaintenanceReceipt;
  decision: "blocked" | "review_required" | "ready";
  generatedAt: string;
}

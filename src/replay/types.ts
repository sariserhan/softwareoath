import type { RepairReceipt } from "../repair/types.js";

export interface ReplaySpec {
  version: 1;
  id: string;
  title: string;
  baseCommit: string;
  humanFixCommit: string;
  findingId?: string;
  expectedChangedPaths?: string[];
  preparationPatch?: string;
  preparation?: {
    evidencePaths: string[];
    command: string;
    allowedPaths: string[];
    ruleId: string;
    ruleTitle: string;
    ruleDescription: string;
    severity: "critical" | "high" | "medium" | "low";
  };
}

export interface ReplayReport {
  version: 1;
  id: string;
  title: string;
  repositoryPath: string;
  baseCommit: string;
  humanFixCommit: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  reproductionConfirmed: boolean;
  repair: RepairReceipt;
  comparison: {
    aiPatchId: string | null;
    humanPatchId: string | null;
    exactPatchMatch: boolean;
    aiChangedPaths: string[];
    humanChangedPaths: string[];
    expectedPathsSatisfied: boolean;
  };
  verdict: "passed" | "failed";
}

export type RuleSeverity = "critical" | "high" | "medium" | "low";
export type EvidenceKind = "command" | "test" | "review";
export type EvidenceStatus = "passed" | "failed" | "human_review";
export type RunDecision = "blocked" | "review_required" | "ready";

export interface OathRule {
  id: string;
  title: string;
  description: string;
  severity: RuleSeverity;
  evidence: Array<{
    kind: EvidenceKind;
    command?: string;
    path?: string;
    required: boolean;
    timeoutMs?: number;
  }>;
  repair?: {
    allowedPaths: string[];
    automaticCandidate: boolean;
  };
}

export interface SoftwareOath {
  version: 1;
  application: {
    name: string;
    repository: string;
    defaultBranch: string;
  };
  approval: {
    requireHumanFor: RuleSeverity[];
    allowAutomaticMerge: boolean;
  };
  cost?: CostPolicy;
  rules: OathRule[];
}

export interface CostPolicy {
  enabled: boolean;
  requireEstimate: boolean;
  currency: string;
  maxMonthlyIncrease?: number;
  maxPercentageIncrease?: number;
}

export interface EvidenceRecord {
  ruleId: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  summary: string;
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  outputSha256?: string;
  runner?: string;
}

export interface RepairRun {
  id: string;
  incident: {
    title: string;
    source: string;
    detectedAt: string;
  };
  repository: {
    branch: string;
    commit: string;
  };
  repair: {
    summary: string;
    files: string[];
    diff: string[];
  };
  evidence: EvidenceRecord[];
}

export interface RuleEvaluation {
  rule: OathRule;
  status: EvidenceStatus;
  evidence: EvidenceRecord[];
  reason: string;
}

export interface OathReport {
  runId: string;
  application: string;
  decision: RunDecision;
  generatedAt: string;
  summary: {
    passed: number;
    failed: number;
    humanReview: number;
  };
  rules: RuleEvaluation[];
}

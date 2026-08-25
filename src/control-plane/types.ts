import type { RunDecision } from "../domain/types";
import type {
  OptimizerAnalysisRecordV1,
  OwnerObservationDecisionV1,
  SignedMigrationSpecificationV1,
} from "../optimizer/types";
import type { ReceiptSignature, RepairReceipt } from "../repair/types";

export interface IncidentRecord {
  id: string;
  source: "sentry" | "stewardship" | "generic-webhook" | string;
  externalId: string;
  title: string;
  status: string;
  priority?: string;
  url?: string;
  project?: string;
  release?: string;
  receivedAt: string;
  payloadDigest: string;
}

export interface HostedRunRecord {
  id: string;
  incidentId: string;
  repository: string;
  commit?: string;
  migrationSpecificationId?: string;
  repairCommit?: string;
  status:
    | "received"
    | "reproducing"
    | "repairing"
    | "verifying"
    | "ci_pending"
    | "ci_failed"
    | "awaiting_approval"
    | "completed"
    | "blocked"
    | "retry_wait"
    | "cancelled";
  decision?: RunDecision;
  repairId?: string;
  pullRequestUrl?: string;
  branch?: string;
  error?: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  decision: "approved" | "rejected";
  actor: string;
  identity: ReviewerIdentity;
  authorization: ReviewerAuthorization;
  reason: string;
  createdAt: string;
}

export interface ReviewerIdentity {
  provider: "github";
  providerUserId: string;
  login: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface ReviewerAuthorization {
  repository: string;
  permission: "admin" | "maintain" | "push";
  verifiedAt: string;
}

export interface ServiceHeartbeatRecord {
  service: "api" | "worker";
  instanceId: string;
  status: "ready" | "stopping";
  observedAt: string;
}

export interface ControlPlaneData {
  version: 1;
  incidents: IncidentRecord[];
  runs: HostedRunRecord[];
  approvals: ApprovalRecord[];
  logs: RunLogRecord[];
  mappings: RepositoryMapping[];
  attestations: FinalAttestation[];
  authSessions: AuthSessionRecord[];
  auditEvents: AuditEventRecord[];
  repositories: RepositoryRegistration[];
  knowledge: RepositoryKnowledgeRecord[];
  optimizerAnalyses: OptimizerAnalysisRecordV1[];
  questions: RepositoryQuestionRecord[];
  heartbeats: ServiceHeartbeatRecord[];
}

export interface FinalAttestation {
  version: 1;
  id: string;
  runId: string;
  incident: {
    id: string;
    source: IncidentRecord["source"];
    externalId: string;
    payloadDigest: string;
  };
  repository: string;
  commits: { base: string; repair?: string };
  delivery: { repairId: string; branch: string; pullRequestUrl: string };
  verification: {
    decision: RunDecision;
    selectedFindingResolved: boolean;
    blockingNewFindings: number;
    cost?: {
      status: NonNullable<RepairReceipt["cost"]>["status"];
      currency: string;
      monthlyCostChange?: number;
      percentageChange?: number;
      baselineSha256?: string;
      proposedSha256?: string;
    };
  };
  repairReceipt: { sha256: string; keyId: string; signature: string };
  decision: {
    value: "approved" | "rejected";
    identity: ReviewerIdentity;
    authorization: ReviewerAuthorization;
    reason: string;
    decidedAt: string;
  };
  generatedAt: string;
  signature: ReceiptSignature;
}

export interface RunReview {
  run: HostedRunRecord;
  incident: IncidentRecord;
  receipt: RepairReceipt;
  patch: string;
  logs: RunLogRecord[];
  receiptVerified: true;
  attestationVerified?: true;
  attestation?: FinalAttestation;
}

export interface AuthSessionRecord {
  id: string;
  identity: ReviewerIdentity;
  encryptedAccessToken: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuditEventRecord {
  id: string;
  action:
    | "auth.login"
    | "auth.logout"
    | "github.install"
    | "decision.allowed"
    | "decision.denied"
    | "knowledge.answer"
    | "knowledge.add_promise"
    | "oath.propose"
    | "optimizer.analyze"
    | "optimizer.observation_decide"
    | "optimizer.usage_confirm"
    | "optimizer.migration_spec_create"
    | "optimizer.migration_spec_authorize";
  outcome: "success" | "denied";
  actor?: ReviewerIdentity;
  runId?: string;
  repository?: string;
  detail: string;
  createdAt: string;
}

export interface RunLogRecord {
  id: string;
  runId: string;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
}

export interface RepositoryMapping {
  id: string;
  sentryProject: string;
  repository: string;
  cloneUrl: string;
  defaultBranch: string;
  installationId?: number;
  localPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunUpdate {
  status?: HostedRunRecord["status"];
  decision?: RunDecision;
  repairId?: string;
  pullRequestUrl?: string;
  branch?: string;
  error?: string;
  nextAttemptAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  cancelRequested?: boolean;
  commit?: string;
  migrationSpecificationId?: string;
  repairCommit?: string;
}

export interface ControlPlaneStore {
  addIncident(
    incident: IncidentRecord,
    run: HostedRunRecord,
  ): Promise<{ incident: IncidentRecord; run: HostedRunRecord; duplicate: boolean }>;
  listRuns(): Promise<HostedRunRecord[]>;
  getRun(id: string): Promise<HostedRunRecord | undefined>;
  getIncident(id: string): Promise<IncidentRecord | undefined>;
  decide(
    approval: ApprovalRecord,
    attestation: FinalAttestation,
    audit: AuditEventRecord,
  ): Promise<HostedRunRecord>;
  getAttestation(runId: string): Promise<FinalAttestation | undefined>;
  claimRun(workerId: string, leaseMs: number, now?: Date): Promise<HostedRunRecord | undefined>;
  updateRun(id: string, update: RunUpdate, now?: Date): Promise<HostedRunRecord>;
  appendLog(log: RunLogRecord): Promise<void>;
  listLogs(runId: string): Promise<RunLogRecord[]>;
  requestCancellation(id: string, now?: Date): Promise<HostedRunRecord>;
  upsertMapping(mapping: RepositoryMapping): Promise<RepositoryMapping>;
  findMapping(sentryProject: string): Promise<RepositoryMapping | undefined>;
  saveAuthSession(session: AuthSessionRecord): Promise<void>;
  getAuthSession(id: string): Promise<AuthSessionRecord | undefined>;
  deleteAuthSession(id: string): Promise<void>;
  appendAudit(event: AuditEventRecord): Promise<void>;
  healthCheck(): Promise<void>;
  upsertHeartbeat(heartbeat: ServiceHeartbeatRecord): Promise<void>;
  getLatestHeartbeat(service: ServiceHeartbeatRecord["service"]): Promise<ServiceHeartbeatRecord | undefined>;
  listRepositories(): Promise<RepositoryRegistration[]>;
  getRepository(repository: string): Promise<RepositoryRegistration | undefined>;
  upsertRepository(
    registration: RepositoryRegistration,
  ): Promise<RepositoryRegistration>;
  listKnowledge(repository: string): Promise<RepositoryKnowledgeRecord[]>;
  upsertKnowledge(
    knowledge: RepositoryKnowledgeRecord,
  ): Promise<RepositoryKnowledgeRecord>;
  listOptimizerAnalyses(repository: string): Promise<OptimizerAnalysisRecordV1[]>;
  getOptimizerAnalysis(id: string): Promise<OptimizerAnalysisRecordV1 | undefined>;
  recordOptimizerDecision(
    analysisId: string,
    repository: string,
    decision: OwnerObservationDecisionV1,
  ): Promise<OptimizerAnalysisRecordV1>;
  recordOptimizerUsage(
    analysisId: string,
    repository: string,
    usage: import("../optimizer/types").OwnerUsageInputV1,
  ): Promise<OptimizerAnalysisRecordV1>;
  saveMigrationSpecification(
    analysisId: string,
    repository: string,
    envelope: SignedMigrationSpecificationV1,
  ): Promise<OptimizerAnalysisRecordV1>;
  saveOptimizerAnalysis(
    analysis: OptimizerAnalysisRecordV1,
  ): Promise<OptimizerAnalysisRecordV1>;
  listQuestions(repository: string): Promise<RepositoryQuestionRecord[]>;
  upsertQuestion(
    question: RepositoryQuestionRecord,
  ): Promise<RepositoryQuestionRecord>;
  answerQuestion(
    questionId: string,
    answer: NonNullable<RepositoryQuestionRecord["answer"]>,
    knowledge: RepositoryKnowledgeRecord,
  ): Promise<RepositoryQuestionRecord>;
}

export interface RepositoryRegistration {
  id: string;
  repository: string;
  cloneUrl: string;
  defaultBranch: string;
  installationId?: number;
  localPath?: string;
  schedule: {
    mode: "disabled" | "daily" | "weekly" | "custom";
    cron?: string;
    timezone: string;
  };
  policy: {
    maxPullRequestsPerRun: number;
    maxCiRepairAttempts: number;
    allowMajorPackageUpdates: boolean;
    automaticMerge: false;
  };
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type RepositoryKnowledgeKind =
  | "observed_technical_fact"
  | "inferred_technical_fact"
  | "owner_confirmed_business_fact"
  | "owner_confirmed_business_rule"
  | "repository_enforced_rule"
  | "temporary_assumption"
  | "accepted_risk"
  | "historical_observation";

export interface RepositoryKnowledgeRecord {
  id: string;
  repository: string;
  kind: RepositoryKnowledgeKind;
  statement: string;
  scope: {
    type: "repository" | "workspace" | "component" | "workflow";
    value: string;
  };
  source: {
    type: "scan" | "repository" | "owner_answer" | "run_outcome";
    runId?: string;
    commit?: string;
    questionId?: string;
    evidence: string[];
  };
  confidence: number;
  relatedPaths: string[];
  blocksRepair: boolean;
  firstObservedAt: string;
  lastVerifiedAt: string;
  firstObservedCommit?: string;
  lastVerifiedCommit?: string;
  confirmedBy?: ReviewerIdentity;
  confirmedAuthorization?: ReviewerAuthorization;
  reviewAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryQuestionRecord {
  id: string;
  repository: string;
  key: string;
  status: "open" | "answered";
  question: string;
  why: string;
  evidence: string[];
  affects: string[];
  suggestedAnswers: string[];
  authorizedRole: "repository_write";
  blocking: "none" | "affected_repair" | "repository";
  answerKnowledgeKind:
    | "owner_confirmed_business_fact"
    | "owner_confirmed_business_rule";
  answer?: {
    value: string;
    identity: ReviewerIdentity;
    authorization: ReviewerAuthorization;
    answeredAt: string;
  };
  knowledgeId?: string;
  createdAt: string;
  updatedAt: string;
}

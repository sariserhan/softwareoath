import type { RunDecision } from "../domain/types";
import type { ReceiptSignature } from "../repair/types";

export interface IncidentRecord {
  id: string;
  source: "sentry";
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
  repairCommit?: string;
  status:
    | "received"
    | "reproducing"
    | "repairing"
    | "verifying"
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
}

export interface FinalAttestation {
  version: 1;
  id: string;
  runId: string;
  incident: {
    id: string;
    source: "sentry";
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
    | "decision.allowed"
    | "decision.denied";
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
}

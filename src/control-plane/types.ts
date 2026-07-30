import type { RunDecision } from "../domain/types";

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
  reason: string;
  createdAt: string;
}

export interface ControlPlaneData {
  version: 1;
  incidents: IncidentRecord[];
  runs: HostedRunRecord[];
  approvals: ApprovalRecord[];
  logs: RunLogRecord[];
  mappings: RepositoryMapping[];
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
}

export interface ControlPlaneStore {
  addIncident(
    incident: IncidentRecord,
    run: HostedRunRecord,
  ): Promise<{ incident: IncidentRecord; run: HostedRunRecord; duplicate: boolean }>;
  listRuns(): Promise<HostedRunRecord[]>;
  getRun(id: string): Promise<HostedRunRecord | undefined>;
  getIncident(id: string): Promise<IncidentRecord | undefined>;
  decide(approval: ApprovalRecord): Promise<HostedRunRecord>;
  claimRun(workerId: string, leaseMs: number, now?: Date): Promise<HostedRunRecord | undefined>;
  updateRun(id: string, update: RunUpdate, now?: Date): Promise<HostedRunRecord>;
  appendLog(log: RunLogRecord): Promise<void>;
  listLogs(runId: string): Promise<RunLogRecord[]>;
  requestCancellation(id: string, now?: Date): Promise<HostedRunRecord>;
  upsertMapping(mapping: RepositoryMapping): Promise<RepositoryMapping>;
  findMapping(sentryProject: string): Promise<RepositoryMapping | undefined>;
}

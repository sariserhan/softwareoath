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
    | "blocked";
  decision?: RunDecision;
  repairId?: string;
  pullRequestUrl?: string;
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
}

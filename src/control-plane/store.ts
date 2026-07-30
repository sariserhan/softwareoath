import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  ApprovalRecord,
  ControlPlaneData,
  ControlPlaneStore,
  HostedRunRecord,
  IncidentRecord,
  RepositoryMapping,
  RunLogRecord,
  RunUpdate,
  FinalAttestation,
  AuthSessionRecord,
  AuditEventRecord,
  RepositoryRegistration,
} from "./types";

const emptyData = (): ControlPlaneData => ({
  version: 1,
  incidents: [],
  runs: [],
  approvals: [],
  logs: [],
  mappings: [],
  attestations: [],
  authSessions: [],
  auditEvents: [],
  repositories: [],
});

export class FileControlPlaneStore implements ControlPlaneStore {
  private writeChain = Promise.resolve();

  constructor(readonly path: string) {
    this.path = resolve(path);
  }

  async read(): Promise<ControlPlaneData> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as ControlPlaneData;
      data.attestations ??= [];
      data.authSessions ??= [];
      data.auditEvents ??= [];
      data.repositories ??= [];
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
      throw error;
    }
  }

  private async update(
    mutate: (data: ControlPlaneData) => void,
  ): Promise<ControlPlaneData> {
    let result = emptyData();
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.read();
      mutate(data);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      result = data;
    });
    await this.writeChain;
    return result;
  }

  async addIncident(
    incident: IncidentRecord,
    run: HostedRunRecord,
  ): Promise<{ incident: IncidentRecord; run: HostedRunRecord; duplicate: boolean }> {
    let duplicate = false;
    let storedIncident = incident;
    let storedRun = run;
    await this.update((data) => {
      const existing = data.incidents.find(
        ({ source, externalId }) =>
          source === incident.source && externalId === incident.externalId,
      );
      if (existing) {
        duplicate = true;
        storedIncident = existing;
        storedRun =
          data.runs.find(({ incidentId }) => incidentId === existing.id) ?? run;
        return;
      }
      data.incidents.push(incident);
      data.runs.push(run);
    });
    return { incident: storedIncident, run: storedRun, duplicate };
  }

  async listRuns(): Promise<HostedRunRecord[]> {
    return (await this.read()).runs.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async getRun(id: string): Promise<HostedRunRecord | undefined> {
    return (await this.read()).runs.find((run) => run.id === id);
  }

  async getIncident(id: string): Promise<IncidentRecord | undefined> {
    return (await this.read()).incidents.find((incident) => incident.id === id);
  }

  async decide(
    approval: ApprovalRecord,
    attestation: FinalAttestation,
  ): Promise<HostedRunRecord> {
    if (attestation.runId !== approval.runId) {
      throw new Error("The final attestation does not belong to this approval.");
    }
    let updated: HostedRunRecord | undefined;
    await this.update((data) => {
      const run = data.runs.find(({ id }) => id === approval.runId);
      if (!run) throw new Error(`Run ${approval.runId} was not found.`);
      if (run.status !== "awaiting_approval") {
        throw new Error(`Run ${approval.runId} is not awaiting approval.`);
      }
      data.approvals.push(approval);
      data.attestations.push(attestation);
      run.status = approval.decision === "approved" ? "completed" : "blocked";
      run.updatedAt = approval.createdAt;
      updated = run;
    });
    return updated!;
  }

  async getAttestation(runId: string): Promise<FinalAttestation | undefined> {
    return (await this.read()).attestations.find(
      (attestation) => attestation.runId === runId,
    );
  }

  async claimRun(
    workerId: string,
    leaseMs: number,
    now = new Date(),
  ): Promise<HostedRunRecord | undefined> {
    let claimed: HostedRunRecord | undefined;
    await this.update((data) => {
      const candidate = data.runs
        .filter(
          (run) =>
            !run.cancelRequested &&
            run.attempts < run.maxAttempts &&
            ["received", "retry_wait"].includes(run.status) &&
            (!run.nextAttemptAt || run.nextAttemptAt <= now.toISOString()) &&
            (!run.leaseExpiresAt || run.leaseExpiresAt <= now.toISOString()),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!candidate) return;
      candidate.attempts += 1;
      candidate.leaseOwner = workerId;
      candidate.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      candidate.updatedAt = now.toISOString();
      claimed = candidate;
    });
    return claimed;
  }

  async updateRun(
    id: string,
    update: RunUpdate,
    now = new Date(),
  ): Promise<HostedRunRecord> {
    let updated: HostedRunRecord | undefined;
    await this.update((data) => {
      const run = data.runs.find((candidate) => candidate.id === id);
      if (!run) throw new Error(`Run ${id} was not found.`);
      Object.assign(run, update, { updatedAt: now.toISOString() });
      updated = run;
    });
    return updated!;
  }

  async appendLog(log: RunLogRecord): Promise<void> {
    await this.update((data) => {
      data.logs.push(log);
    });
  }

  async listLogs(runId: string): Promise<RunLogRecord[]> {
    return (await this.read()).logs.filter((log) => log.runId === runId);
  }

  async requestCancellation(
    id: string,
    now = new Date(),
  ): Promise<HostedRunRecord> {
    const run = await this.getRun(id);
    if (!run) throw new Error(`Run ${id} was not found.`);
    return await this.updateRun(
      id,
      run.leaseOwner
        ? { cancelRequested: true }
        : { cancelRequested: true, status: "cancelled" },
      now,
    );
  }

  async upsertMapping(
    mapping: RepositoryMapping,
  ): Promise<RepositoryMapping> {
    let stored = mapping;
    await this.update((data) => {
      const existing = data.mappings.find(
        ({ sentryProject }) => sentryProject === mapping.sentryProject,
      );
      if (existing) {
        Object.assign(existing, mapping, { id: existing.id });
        stored = existing;
      } else {
        data.mappings.push(mapping);
      }
    });
    return stored;
  }

  async findMapping(
    sentryProject: string,
  ): Promise<RepositoryMapping | undefined> {
    return (await this.read()).mappings.find(
      (mapping) => mapping.sentryProject === sentryProject,
    );
  }

  async saveAuthSession(session: AuthSessionRecord): Promise<void> {
    await this.update((data) => {
      data.authSessions = data.authSessions.filter(({ id }) => id !== session.id);
      data.authSessions.push(session);
    });
  }

  async getAuthSession(id: string): Promise<AuthSessionRecord | undefined> {
    return (await this.read()).authSessions.find((session) => session.id === id);
  }

  async deleteAuthSession(id: string): Promise<void> {
    await this.update((data) => {
      data.authSessions = data.authSessions.filter((session) => session.id !== id);
    });
  }

  async appendAudit(event: AuditEventRecord): Promise<void> {
    await this.update((data) => {
      data.auditEvents.push(event);
    });
  }

  async listRepositories(): Promise<RepositoryRegistration[]> {
    return (await this.read()).repositories;
  }

  async getRepository(
    repository: string,
  ): Promise<RepositoryRegistration | undefined> {
    return (await this.read()).repositories.find(
      (registration) => registration.repository === repository,
    );
  }

  async upsertRepository(
    registration: RepositoryRegistration,
  ): Promise<RepositoryRegistration> {
    let stored = registration;
    await this.update((data) => {
      const existing = data.repositories.find(
        ({ repository }) => repository === registration.repository,
      );
      if (existing) {
        Object.assign(existing, registration, { id: existing.id });
        stored = existing;
      } else {
        data.repositories.push(registration);
      }
    });
    return stored;
  }
}

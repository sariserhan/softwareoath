import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  OptimizerAnalysisRecordV1,
  OwnerObservationDecisionV1,
  OwnerUsageInputV1,
  SignedMigrationSpecificationV1,
} from "../optimizer/types";

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
  RepositoryKnowledgeRecord,
  RepositoryQuestionRecord,
  ServiceHeartbeatRecord,
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
  optimizerAnalyses: [],
  knowledge: [],
  questions: [],
  heartbeats: [],
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
      data.optimizerAnalyses.forEach((analysis) => {
        analysis.ownerDecisions ??= [];
      });
      data.auditEvents ??= [];
      data.optimizerAnalyses ??= [];
      data.repositories ??= [];
      data.knowledge ??= [];
      data.questions ??= [];
      data.heartbeats ??= [];
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
    const operation = this.writeChain.then(async () => {
      const data = await this.read();
      mutate(data);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      result = data;
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined,
    );
    await operation;
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
    audit: AuditEventRecord,
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
      data.auditEvents.push(audit);
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
            [
              "received",
              "retry_wait",
              "reproducing",
              "repairing",
              "verifying",
            ].includes(run.status) &&
            (!run.nextAttemptAt || run.nextAttemptAt <= now.toISOString()) &&
            (!run.leaseExpiresAt || run.leaseExpiresAt <= now.toISOString()),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!candidate) return;
      candidate.attempts += 1;
      candidate.error = undefined;
      candidate.nextAttemptAt = undefined;
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

  async healthCheck(): Promise<void> {
    await this.read();
  }

  async upsertHeartbeat(heartbeat: ServiceHeartbeatRecord): Promise<void> {
    await this.update((data) => {
      const index = data.heartbeats.findIndex(({ service, instanceId }) =>
        service === heartbeat.service && instanceId === heartbeat.instanceId);
      if (index >= 0) data.heartbeats[index] = heartbeat;
      else data.heartbeats.push(heartbeat);
    });
  }

  async getLatestHeartbeat(
    service: ServiceHeartbeatRecord["service"],
  ): Promise<ServiceHeartbeatRecord | undefined> {
    return (await this.read()).heartbeats
      .filter((heartbeat) => heartbeat.service === service)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
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

  async listKnowledge(repository: string): Promise<RepositoryKnowledgeRecord[]> {
    return (await this.read()).knowledge.filter(
      (knowledge) => knowledge.repository === repository,
    );
  }

  async upsertKnowledge(
    knowledge: RepositoryKnowledgeRecord,
  ): Promise<RepositoryKnowledgeRecord> {
    let stored = knowledge;
    await this.update((data) => {
      const existing = data.knowledge.find(({ id }) => id === knowledge.id);
      if (existing) {
        Object.assign(existing, knowledge, {
          firstObservedAt: existing.firstObservedAt,
          firstObservedCommit: existing.firstObservedCommit,
          createdAt: existing.createdAt,
        });
        stored = existing;
      } else {
        data.knowledge.push(knowledge);
      }
    });
    return stored;
  }

  async listOptimizerAnalyses(
    repository: string,
  ): Promise<OptimizerAnalysisRecordV1[]> {
    return (await this.read()).optimizerAnalyses
      .filter((analysis) => analysis.repository === repository)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getOptimizerAnalysis(
    id: string,
  ): Promise<OptimizerAnalysisRecordV1 | undefined> {
    return (await this.read()).optimizerAnalyses.find(
      (analysis) => analysis.id === id,
    );
  }

  async saveOptimizerAnalysis(
    analysis: OptimizerAnalysisRecordV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    const registration = await this.getRepository(analysis.repository);
    if (!registration || registration.id !== analysis.repositoryId) {
      throw new Error("Optimizer analysis does not belong to a registered repository.");
    }
    let stored = analysis;
    await this.update((data) => {
      const existing = data.optimizerAnalyses.find(({ id }) => id === analysis.id);
      if (existing) {
        if (
          existing.repository !== analysis.repository ||
          existing.tenantKey !== analysis.tenantKey
        ) {
          throw new Error("Optimizer analysis ownership cannot be changed.");
        }
        Object.assign(existing, analysis, {
          createdAt: existing.createdAt,
          ownerDecisions: existing.ownerDecisions ?? [],
          ownerUsage: existing.ownerUsage,
          migrationSpecifications: existing.migrationSpecifications ?? [],
        });
        stored = existing;
      } else {
        data.optimizerAnalyses.push(analysis);
      }
    });
    return stored;
  }

  async recordOptimizerDecision(
    analysisId: string,
    repository: string,
    decision: OwnerObservationDecisionV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    let stored: OptimizerAnalysisRecordV1 | undefined;
    await this.update((data) => {
      const analysis = data.optimizerAnalyses.find(({ id }) => id === analysisId);
      if (!analysis || analysis.repository !== repository) {
        throw new Error("Optimizer analysis was not found.");
      }
      analysis.ownerDecisions ??= [];
      if (analysis.ownerDecisions.some(({ id }) => id === decision.id)) {
        throw new Error("Optimizer owner decision already exists.");
      }
      analysis.ownerDecisions.push(decision);
      stored = analysis;
    });
    if (!stored) {
      throw new Error("Optimizer owner decision could not be stored.");
    }
    return stored;
  }

  async recordOptimizerUsage(
    analysisId: string,
    repository: string,
    usage: OwnerUsageInputV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    let stored: OptimizerAnalysisRecordV1 | undefined;
    await this.update((data) => {
      const analysis = data.optimizerAnalyses.find(({ id }) => id === analysisId);
      if (!analysis || analysis.repository !== repository) {
        throw new Error("Optimizer analysis was not found.");
      }
      analysis.ownerUsage = usage;
      stored = analysis;
    });
    if (!stored) throw new Error("Optimizer usage could not be stored.");
    return stored;
  }

  async saveMigrationSpecification(
    analysisId: string,
    repository: string,
    envelope: SignedMigrationSpecificationV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    let stored: OptimizerAnalysisRecordV1 | undefined;
    await this.update((data) => {
      const analysis = data.optimizerAnalyses.find(({ id }) => id === analysisId);
      if (!analysis || analysis.repository !== repository) {
        throw new Error("Optimizer analysis was not found.");
      }
      analysis.migrationSpecifications ??= [];
      const index = analysis.migrationSpecifications.findIndex(
        ({ specification }) => specification.id === envelope.specification.id,
      );
      if (index >= 0) analysis.migrationSpecifications[index] = envelope;
      else analysis.migrationSpecifications.push(envelope);
      stored = analysis;
    });
    if (!stored) throw new Error("Migration specification could not be stored.");
    return stored;
  }

  async listQuestions(repository: string): Promise<RepositoryQuestionRecord[]> {
    return (await this.read()).questions.filter(
      (question) => question.repository === repository,
    );
  }

  async upsertQuestion(
    question: RepositoryQuestionRecord,
  ): Promise<RepositoryQuestionRecord> {
    let stored = question;
    await this.update((data) => {
      const existing = data.questions.find(
        ({ repository, key }) =>
          repository === question.repository && key === question.key,
      );
      if (existing) {
        stored = existing;
      } else {
        data.questions.push(question);
      }
    });
    return stored;
  }

  async answerQuestion(
    questionId: string,
    answer: NonNullable<RepositoryQuestionRecord["answer"]>,
    knowledge: RepositoryKnowledgeRecord,
  ): Promise<RepositoryQuestionRecord> {
    let stored: RepositoryQuestionRecord | undefined;
    await this.update((data) => {
      const question = data.questions.find(({ id }) => id === questionId);
      if (!question) throw new Error(`Question ${questionId} was not found.`);
      if (question.status === "answered") {
        throw new Error(`Question ${questionId} has already been answered.`);
      }
      if (question.repository !== knowledge.repository) {
        throw new Error("Question answer knowledge belongs to another repository.");
      }
      question.status = "answered";
      question.answer = answer;
      question.knowledgeId = knowledge.id;
      question.updatedAt = answer.answeredAt;
      data.knowledge.push(knowledge);
      stored = question;
    });
    return stored!;
  }
}

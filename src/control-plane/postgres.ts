import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  OptimizerAnalysisRecordV1,
  OwnerObservationDecisionV1,
  OwnerUsageInputV1,
  SignedMigrationSpecificationV1,
} from "../optimizer/types.js";

import type {
  ApprovalRecord,
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
} from "./types.js";

type Row = QueryResultRow & Record<string, unknown>;

function iso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function optimizerAnalysisFromDocument(
  value: unknown,
): OptimizerAnalysisRecordV1 {
  const analysis = value as OptimizerAnalysisRecordV1;
  return {
    ...analysis,
    ownerDecisions: analysis.ownerDecisions ?? [],
  };
}

function runFromRow(row: Row): HostedRunRecord {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    repository: String(row.repository),
    commit: row.commit_sha ? String(row.commit_sha) : undefined,
    migrationSpecificationId: row.migration_specification_id
      ? String(row.migration_specification_id) : undefined,
    repairCommit: row.repair_commit_sha ? String(row.repair_commit_sha) : undefined,
    status: row.status as HostedRunRecord["status"],
    decision: row.decision as HostedRunRecord["decision"],
    repairId: row.repair_id ? String(row.repair_id) : undefined,
    pullRequestUrl: row.pull_request_url
      ? String(row.pull_request_url)
      : undefined,
    branch: row.branch ? String(row.branch) : undefined,
    error: row.error ? String(row.error) : undefined,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: iso(row.next_attempt_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : undefined,
    leaseExpiresAt: iso(row.lease_expires_at),
    cancelRequested: Boolean(row.cancel_requested),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function incidentFromRow(row: Row): IncidentRecord {
  return {
    id: String(row.id),
    source: row.source as IncidentRecord["source"],
    externalId: String(row.external_id),
    title: String(row.title),
    status: String(row.status),
    priority: row.priority ? String(row.priority) : undefined,
    url: row.url ? String(row.url) : undefined,
    project: row.project ? String(row.project) : undefined,
    release: row.release ? String(row.release) : undefined,
    receivedAt: iso(row.received_at)!,
    payloadDigest: String(row.payload_digest),
  };
}

function mappingFromRow(row: Row): RepositoryMapping {
  return {
    id: String(row.id),
    sentryProject: String(row.sentry_project),
    repository: String(row.repository),
    cloneUrl: String(row.clone_url),
    defaultBranch: String(row.default_branch),
    installationId:
      row.installation_id === null ? undefined : Number(row.installation_id),
    localPath: row.local_path ? String(row.local_path) : undefined,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresControlPlaneStore implements ControlPlaneStore {
  constructor(readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresControlPlaneStore {
    return new PostgresControlPlaneStore(
      new Pool({
        connectionString,
        max: Number(process.env.SOFTWARE_OATH_DB_POOL_SIZE ?? 10),
        ssl:
          process.env.SOFTWARE_OATH_DB_SSL === "disable"
            ? false
            : { rejectUnauthorized: false },
      }),
    );
  }

  async addIncident(incident: IncidentRecord, run: HostedRunRecord) {
    return await transaction(this.pool, async (client) => {
      const inserted = await client.query<Row>(
        `INSERT INTO incidents (
          id, source, external_id, title, status, priority, url, project, release,
          received_at, payload_digest
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (source, external_id) DO NOTHING
        RETURNING *`,
        [
          incident.id,
          incident.source,
          incident.externalId,
          incident.title,
          incident.status,
          incident.priority ?? null,
          incident.url ?? null,
          incident.project ?? null,
          incident.release ?? null,
          incident.receivedAt,
          incident.payloadDigest,
        ],
      );
      if (inserted.rowCount === 0) {
        const existingIncident = await client.query<Row>(
          "SELECT * FROM incidents WHERE source = $1 AND external_id = $2",
          [incident.source, incident.externalId],
        );
        const existingRun = await client.query<Row>(
          "SELECT * FROM runs WHERE incident_id = $1 ORDER BY created_at LIMIT 1",
          [existingIncident.rows[0].id],
        );
        return {
          incident: incidentFromRow(existingIncident.rows[0]),
          run: runFromRow(existingRun.rows[0]),
          duplicate: true,
        };
      }
      await client.query(
        `INSERT INTO runs (
          id, incident_id, repository, commit_sha, status, attempts, max_attempts,
          cancel_requested, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          run.id,
          run.incidentId,
          run.repository,
          run.commit ?? null,
          run.status,
          run.attempts,
          run.maxAttempts,
          run.cancelRequested,
          run.createdAt,
          run.updatedAt,
        ],
      );
      return { incident, run, duplicate: false };
    });
  }

  async listRuns(): Promise<HostedRunRecord[]> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM runs ORDER BY created_at DESC",
    );
    return result.rows.map(runFromRow);
  }

  async getRun(id: string): Promise<HostedRunRecord | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM runs WHERE id = $1",
      [id],
    );
    return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
  }

  async getIncident(id: string): Promise<IncidentRecord | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM incidents WHERE id = $1",
      [id],
    );
    return result.rows[0] ? incidentFromRow(result.rows[0]) : undefined;
  }

  async decide(
    approval: ApprovalRecord,
    attestation: FinalAttestation,
    audit: AuditEventRecord,
  ): Promise<HostedRunRecord> {
    if (attestation.runId !== approval.runId) {
      throw new Error("The final attestation does not belong to this approval.");
    }
    return await transaction(this.pool, async (client) => {
      const locked = await client.query<Row>(
        "SELECT * FROM runs WHERE id = $1 FOR UPDATE",
        [approval.runId],
      );
      if (!locked.rows[0]) throw new Error(`Run ${approval.runId} was not found.`);
      if (locked.rows[0].status !== "awaiting_approval") {
        throw new Error(`Run ${approval.runId} is not awaiting approval.`);
      }
      await client.query(
        `INSERT INTO approvals (
          id, run_id, decision, actor, reason, created_at,
          provider, provider_user_id, login, authorization_repository,
          authorization_permission, authorization_verified_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          approval.id,
          approval.runId,
          approval.decision,
          approval.actor,
          approval.reason,
          approval.createdAt,
          approval.identity.provider,
          approval.identity.providerUserId,
          approval.identity.login,
          approval.authorization.repository,
          approval.authorization.permission,
          approval.authorization.verifiedAt,
        ],
      );
      await client.query(
        `INSERT INTO final_attestations (id, run_id, document, created_at)
         VALUES ($1,$2,$3,$4)`,
        [
          attestation.id,
          attestation.runId,
          JSON.stringify(attestation),
          attestation.generatedAt,
        ],
      );
      await client.query(
        `INSERT INTO audit_events (
          id, action, outcome, provider, provider_user_id, login,
          run_id, repository, detail, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          audit.id,
          audit.action,
          audit.outcome,
          audit.actor?.provider ?? null,
          audit.actor?.providerUserId ?? null,
          audit.actor?.login ?? null,
          audit.runId ?? null,
          audit.repository ?? null,
          audit.detail,
          audit.createdAt,
        ],
      );
      const updated = await client.query<Row>(
        `UPDATE runs SET status = $2, updated_at = $3
         WHERE id = $1 RETURNING *`,
        [
          approval.runId,
          approval.decision === "approved" ? "completed" : "blocked",
          approval.createdAt,
        ],
      );
      return runFromRow(updated.rows[0]);
    });
  }

  async getAttestation(runId: string): Promise<FinalAttestation | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT document FROM final_attestations WHERE run_id = $1",
      [runId],
    );
    return result.rows[0]?.document as FinalAttestation | undefined;
  }

  async claimRun(
    workerId: string,
    leaseMs: number,
    now = new Date(),
  ): Promise<HostedRunRecord | undefined> {
    return await transaction(this.pool, async (client) => {
      const expiresAt = new Date(now.getTime() + leaseMs);
      const result = await client.query<Row>(
        `WITH candidate AS (
          SELECT id FROM runs
          WHERE status IN (
            'received', 'retry_wait', 'reproducing', 'repairing', 'verifying'
          )
            AND cancel_requested = false
            AND attempts < max_attempts
            AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
            AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE runs
        SET attempts = attempts + 1, error = NULL, next_attempt_at = NULL,
            lease_owner = $2, lease_expires_at = $3,
            updated_at = $1
        WHERE id = (SELECT id FROM candidate)
        RETURNING *`,
        [now, workerId, expiresAt],
      );
      return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
    });
  }

  async updateRun(
    id: string,
    update: RunUpdate,
    now = new Date(),
  ): Promise<HostedRunRecord> {
    const entries = Object.entries({
      status: update.status,
      decision: update.decision,
      repair_id: update.repairId,
      pull_request_url: update.pullRequestUrl,
      branch: update.branch,
      error: update.error,
      next_attempt_at: update.nextAttemptAt,
      lease_owner: update.leaseOwner,
      lease_expires_at: update.leaseExpiresAt,
      cancel_requested: update.cancelRequested,
      commit_sha: update.commit,
      migration_specification_id: update.migrationSpecificationId,
      repair_commit_sha: update.repairCommit,
    }).filter(([, value]) => value !== undefined);
    const values = entries.map(([, value]) => value);
    const assignments = entries.map(
      ([column], index) => `${column} = $${index + 2}`,
    );
    assignments.push(`updated_at = $${values.length + 2}`);
    const result = await this.pool.query<Row>(
      `UPDATE runs SET ${assignments.join(", ")}
       WHERE id = $1 RETURNING *`,
      [id, ...values, now],
    );
    if (!result.rows[0]) throw new Error(`Run ${id} was not found.`);
    return runFromRow(result.rows[0]);
  }

  async appendLog(log: RunLogRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_logs (id, run_id, level, message, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [log.id, log.runId, log.level, log.message, log.createdAt],
    );
  }

  async listLogs(runId: string): Promise<RunLogRecord[]> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM run_logs WHERE run_id = $1 ORDER BY created_at",
      [runId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      level: row.level as RunLogRecord["level"],
      message: String(row.message),
      createdAt: iso(row.created_at)!,
    }));
  }

  async requestCancellation(
    id: string,
    now = new Date(),
  ): Promise<HostedRunRecord> {
    const result = await this.pool.query<Row>(
      `UPDATE runs
       SET cancel_requested = true,
           status = CASE WHEN lease_owner IS NULL THEN 'cancelled' ELSE status END,
           updated_at = $2
       WHERE id = $1 RETURNING *`,
      [id, now],
    );
    if (!result.rows[0]) throw new Error(`Run ${id} was not found.`);
    return runFromRow(result.rows[0]);
  }

  async retryRun(id: string, now = new Date()): Promise<HostedRunRecord> {
    const result = await this.pool.query<Row>(
      `UPDATE runs SET status = 'received', attempts = 0, cancel_requested = false,
       error = NULL, next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
       updated_at = $2 WHERE id = $1 AND status IN ('blocked', 'cancelled', 'ci_failed')
       RETURNING *`, [id, now],
    );
    if (result.rows[0]) return runFromRow(result.rows[0]);
    const current = await this.getRun(id);
    if (!current) throw new Error(`Run ${id} was not found.`);
    throw new Error(`Run ${id} is not retryable from ${current.status}.`);
  }

  async upsertMapping(
    mapping: RepositoryMapping,
  ): Promise<RepositoryMapping> {
    const result = await this.pool.query<Row>(
      `INSERT INTO repository_mappings (
        id, sentry_project, repository, clone_url, default_branch,
        installation_id, local_path, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (sentry_project) DO UPDATE SET
        repository = EXCLUDED.repository,
        clone_url = EXCLUDED.clone_url,
        default_branch = EXCLUDED.default_branch,
        installation_id = EXCLUDED.installation_id,
        local_path = EXCLUDED.local_path,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        mapping.id,
        mapping.sentryProject,
        mapping.repository,
        mapping.cloneUrl,
        mapping.defaultBranch,
        mapping.installationId ?? null,
        mapping.localPath ?? null,
        mapping.createdAt,
        mapping.updatedAt,
      ],
    );
    return mappingFromRow(result.rows[0]);
  }

  async findMapping(
    sentryProject: string,
  ): Promise<RepositoryMapping | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM repository_mappings WHERE sentry_project = $1",
      [sentryProject],
    );
    return result.rows[0] ? mappingFromRow(result.rows[0]) : undefined;
  }

  async saveAuthSession(session: AuthSessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions (
        id, provider, provider_user_id, login, display_name, avatar_url,
        encrypted_access_token, csrf_token, created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        csrf_token = EXCLUDED.csrf_token,
        expires_at = EXCLUDED.expires_at`,
      [
        session.id,
        session.identity.provider,
        session.identity.providerUserId,
        session.identity.login,
        session.identity.displayName ?? null,
        session.identity.avatarUrl ?? null,
        session.encryptedAccessToken,
        session.csrfToken,
        session.createdAt,
        session.expiresAt,
      ],
    );
  }

  async getAuthSession(id: string): Promise<AuthSessionRecord | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM auth_sessions WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: String(row.id),
      identity: {
        provider: "github",
        providerUserId: String(row.provider_user_id),
        login: String(row.login),
        displayName: row.display_name ? String(row.display_name) : undefined,
        avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
      },
      encryptedAccessToken: String(row.encrypted_access_token),
      csrfToken: String(row.csrf_token),
      createdAt: iso(row.created_at)!,
      expiresAt: iso(row.expires_at)!,
    };
  }

  async deleteAuthSession(id: string): Promise<void> {
    await this.pool.query("DELETE FROM auth_sessions WHERE id = $1", [id]);
  }

  async appendAudit(event: AuditEventRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (
        id, action, outcome, provider, provider_user_id, login,
        run_id, repository, detail, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        event.id,
        event.action,
        event.outcome,
        event.actor?.provider ?? null,
        event.actor?.providerUserId ?? null,
        event.actor?.login ?? null,
        event.runId ?? null,
        event.repository ?? null,
        event.detail,
        event.createdAt,
      ],
    );
  }

  async listAuditEvents(repository?: string): Promise<AuditEventRecord[]> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM audit_events WHERE ($1::text IS NULL OR repository = $1) ORDER BY created_at",
      [repository ?? null],
    );
    return result.rows.map((row) => ({ id: String(row.id), action: row.action as AuditEventRecord["action"],
      outcome: row.outcome as AuditEventRecord["outcome"],
      actor: row.provider ? { provider: "github", providerUserId: String(row.provider_user_id),
        login: String(row.login) } : undefined, runId: row.run_id ? String(row.run_id) : undefined,
      repository: row.repository ? String(row.repository) : undefined, detail: String(row.detail),
      createdAt: iso(row.created_at)! }));
  }

  async garbageCollect(now = new Date()): Promise<{ authSessions: number; heartbeats: number }> {
    return transaction(this.pool, async (client) => {
      const sessions = await client.query("DELETE FROM auth_sessions WHERE expires_at <= $1", [now]);
      const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const heartbeats = await client.query("DELETE FROM service_heartbeats WHERE observed_at < $1", [cutoff]);
      return { authSessions: sessions.rowCount ?? 0, heartbeats: heartbeats.rowCount ?? 0 };
    });
  }

  async deleteRepositoryData(repository: string): Promise<{ repairIds: string[]; records: number }> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<Row>(
        "SELECT id, incident_id, repair_id FROM runs WHERE repository = $1 FOR UPDATE", [repository]);
      const runIds = selected.rows.map(({ id }) => String(id));
      const incidentIds = selected.rows.map(({ incident_id }) => String(incident_id));
      const repairIds = selected.rows.flatMap(({ repair_id }) => repair_id ? [String(repair_id)] : []);
      let records = 0;
      const remove = async (sql: string, values: unknown[]) => {
        const result = await client.query(sql, values); records += result.rowCount ?? 0;
      };
      await remove("DELETE FROM audit_events WHERE repository = $1 OR run_id = ANY($2::text[])", [repository, runIds]);
      await remove("DELETE FROM final_attestations WHERE run_id = ANY($1::text[])", [runIds]);
      await remove("DELETE FROM approvals WHERE run_id = ANY($1::text[])", [runIds]);
      await remove("DELETE FROM run_logs WHERE run_id = ANY($1::text[])", [runIds]);
      await remove("DELETE FROM runs WHERE id = ANY($1::text[])", [runIds]);
      await remove("DELETE FROM incidents WHERE id = ANY($1::text[]) AND NOT EXISTS " +
        "(SELECT 1 FROM runs WHERE runs.incident_id = incidents.id)", [incidentIds]);
      await remove("DELETE FROM repository_mappings WHERE repository = $1", [repository]);
      await remove("DELETE FROM repository_questions WHERE repository = $1", [repository]);
      await remove("DELETE FROM repository_knowledge WHERE repository = $1", [repository]);
      await remove("DELETE FROM stewardship_repositories WHERE repository = $1", [repository]);
      return { repairIds, records };
    });
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async upsertHeartbeat(heartbeat: ServiceHeartbeatRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO service_heartbeats (service, instance_id, status, observed_at) " +
      "VALUES ($1,$2,$3,$4) ON CONFLICT (service, instance_id) DO UPDATE SET " +
      "status = EXCLUDED.status, observed_at = EXCLUDED.observed_at",
      [heartbeat.service, heartbeat.instanceId, heartbeat.status, heartbeat.observedAt],
    );
  }

  async getLatestHeartbeat(
    service: ServiceHeartbeatRecord["service"],
  ): Promise<ServiceHeartbeatRecord | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT service, instance_id, status, observed_at FROM service_heartbeats " +
      "WHERE service = $1 ORDER BY observed_at DESC LIMIT 1", [service],
    );
    const row = result.rows[0];
    return row ? { service: row.service as ServiceHeartbeatRecord["service"],
      instanceId: String(row.instance_id), status: row.status as ServiceHeartbeatRecord["status"],
      observedAt: iso(row.observed_at)! } : undefined;
  }

  async listRepositories(): Promise<RepositoryRegistration[]> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM stewardship_repositories ORDER BY repository",
    );
    return result.rows.map(registrationFromRow);
  }

  async getRepository(
    repository: string,
  ): Promise<RepositoryRegistration | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM stewardship_repositories WHERE repository = $1",
      [repository],
    );
    return result.rows[0] ? registrationFromRow(result.rows[0]) : undefined;
  }

  async upsertRepository(
    registration: RepositoryRegistration,
  ): Promise<RepositoryRegistration> {
    const result = await this.pool.query<Row>(
      `INSERT INTO stewardship_repositories (
        id, repository, clone_url, default_branch, installation_id, local_path,
        schedule_mode, schedule_cron, schedule_timezone,
        max_pull_requests_per_run, max_ci_repair_attempts,
        allow_major_package_updates, next_run_at, last_run_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (repository) DO UPDATE SET
        clone_url = EXCLUDED.clone_url,
        default_branch = EXCLUDED.default_branch,
        installation_id = EXCLUDED.installation_id,
        local_path = EXCLUDED.local_path,
        schedule_mode = EXCLUDED.schedule_mode,
        schedule_cron = EXCLUDED.schedule_cron,
        schedule_timezone = EXCLUDED.schedule_timezone,
        max_pull_requests_per_run = EXCLUDED.max_pull_requests_per_run,
        max_ci_repair_attempts = EXCLUDED.max_ci_repair_attempts,
        allow_major_package_updates = EXCLUDED.allow_major_package_updates,
        next_run_at = EXCLUDED.next_run_at,
        last_run_at = EXCLUDED.last_run_at,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        registration.id,
        registration.repository,
        registration.cloneUrl,
        registration.defaultBranch,
        registration.installationId ?? null,
        registration.localPath ?? null,
        registration.schedule.mode,
        registration.schedule.cron ?? null,
        registration.schedule.timezone,
        registration.policy.maxPullRequestsPerRun,
        registration.policy.maxCiRepairAttempts,
        registration.policy.allowMajorPackageUpdates,
        registration.nextRunAt ?? null,
        registration.lastRunAt ?? null,
        registration.createdAt,
        registration.updatedAt,
      ],
    );
    return registrationFromRow(result.rows[0]);
  }

  async listKnowledge(repository: string): Promise<RepositoryKnowledgeRecord[]> {
    const result = await this.pool.query<Row>(
      `SELECT document FROM repository_knowledge
       WHERE repository = $1 ORDER BY updated_at DESC`,
      [repository],
    );
    return result.rows.map(
      (row) => row.document as RepositoryKnowledgeRecord,
    );
  }

  async upsertKnowledge(
    knowledge: RepositoryKnowledgeRecord,
  ): Promise<RepositoryKnowledgeRecord> {
    const result = await this.pool.query<Row>(
      `INSERT INTO repository_knowledge (
        id, repository, kind, document, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        kind = EXCLUDED.kind,
        document = EXCLUDED.document,
        updated_at = EXCLUDED.updated_at
      RETURNING document`,
      [
        knowledge.id,
        knowledge.repository,
        knowledge.kind,
        JSON.stringify(knowledge),
        knowledge.createdAt,
        knowledge.updatedAt,
      ],
    );
    return result.rows[0].document as RepositoryKnowledgeRecord;
  }

  async listOptimizerAnalyses(
    repository: string,
  ): Promise<OptimizerAnalysisRecordV1[]> {
    const result = await this.pool.query<Row>(
      "SELECT document FROM optimizer_analyses WHERE repository = $1 ORDER BY created_at DESC",
      [repository],
    );
    return result.rows.map((row) =>
      optimizerAnalysisFromDocument(row.document),
    );
  }

  async getOptimizerAnalysis(
    id: string,
  ): Promise<OptimizerAnalysisRecordV1 | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT document FROM optimizer_analyses WHERE id = $1",
      [id],
    );
    return result.rows[0]
      ? optimizerAnalysisFromDocument(result.rows[0].document)
      : undefined;
  }

  async recordOptimizerDecision(
    analysisId: string,
    repository: string,
    decision: OwnerObservationDecisionV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<Row>(
        "SELECT document FROM optimizer_analyses " +
          "WHERE id = $1 AND repository = $2 FOR UPDATE",
        [analysisId, repository],
      );
      const analysis = selected.rows[0]
        ? optimizerAnalysisFromDocument(selected.rows[0].document)
        : undefined;
      if (!analysis) {
        throw new Error("Optimizer analysis was not found.");
      }
      analysis.ownerDecisions ??= [];
      if (analysis.ownerDecisions.some(({ id }) => id === decision.id)) {
        throw new Error("Optimizer owner decision already exists.");
      }
      analysis.ownerDecisions.push(decision);
      await client.query(
        "UPDATE optimizer_analyses SET document = $1 WHERE id = $2",
        [JSON.stringify(analysis), analysisId],
      );
      return analysis;
    });
  }

  async recordOptimizerUsage(
    analysisId: string,
    repository: string,
    usage: OwnerUsageInputV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<Row>(
        "SELECT document FROM optimizer_analyses WHERE id = $1 AND repository = $2 FOR UPDATE",
        [analysisId, repository],
      );
      const analysis = selected.rows[0]
        ? optimizerAnalysisFromDocument(selected.rows[0].document) : undefined;
      if (!analysis) throw new Error("Optimizer analysis was not found.");
      analysis.ownerUsage = usage;
      await client.query(
        "UPDATE optimizer_analyses SET document = $1 WHERE id = $2",
        [JSON.stringify(analysis), analysisId],
      );
      return analysis;
    });
  }

  async saveMigrationSpecification(
    analysisId: string,
    repository: string,
    envelope: SignedMigrationSpecificationV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<Row>(
        "SELECT document FROM optimizer_analyses WHERE id = $1 AND repository = $2 FOR UPDATE",
        [analysisId, repository],
      );
      const analysis = selected.rows[0]
        ? optimizerAnalysisFromDocument(selected.rows[0].document) : undefined;
      if (!analysis) throw new Error("Optimizer analysis was not found.");
      analysis.migrationSpecifications ??= [];
      const index = analysis.migrationSpecifications.findIndex(
        ({ specification }) => specification.id === envelope.specification.id,
      );
      if (index >= 0) analysis.migrationSpecifications[index] = envelope;
      else analysis.migrationSpecifications.push(envelope);
      await client.query(
        "UPDATE optimizer_analyses SET document = $1 WHERE id = $2",
        [JSON.stringify(analysis), analysisId],
      );
      return analysis;
    });
  }

  async saveOptimizerAnalysis(
    analysis: OptimizerAnalysisRecordV1,
  ): Promise<OptimizerAnalysisRecordV1> {
    const registration = await this.pool.query(
      "SELECT 1 FROM stewardship_repositories WHERE id = $1 AND repository = $2",
      [analysis.repositoryId, analysis.repository],
    );
    if (!registration.rowCount) {
      throw new Error("Optimizer analysis does not belong to a registered repository.");
    }
    const result = await this.pool.query<Row>(
      "INSERT INTO optimizer_analyses (" +
        "id, tenant_key, repository_id, repository, commit_sha, status, " +
        "analyzer_version, document, created_at, completed_at" +
        ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
        "ON CONFLICT (id) DO UPDATE SET " +
        "commit_sha = EXCLUDED.commit_sha, status = EXCLUDED.status, " +
        "analyzer_version = EXCLUDED.analyzer_version, " +
        "document = jsonb_set(jsonb_set(jsonb_set(EXCLUDED.document, '{ownerDecisions}', " +
        "COALESCE(optimizer_analyses.document->'ownerDecisions', '[]'::jsonb)), " +
        "'{ownerUsage}', COALESCE(optimizer_analyses.document->'ownerUsage', " +
        "EXCLUDED.document->'ownerUsage', 'null'::jsonb)), '{migrationSpecifications}', " +
        "COALESCE(optimizer_analyses.document->'migrationSpecifications', '[]'::jsonb)), " +
        "completed_at = EXCLUDED.completed_at " +
        "WHERE optimizer_analyses.tenant_key = EXCLUDED.tenant_key " +
        "AND optimizer_analyses.repository_id = EXCLUDED.repository_id " +
        "AND optimizer_analyses.repository = EXCLUDED.repository " +
        "RETURNING document",
      [
        analysis.id,
        analysis.tenantKey,
        analysis.repositoryId,
        analysis.repository,
        analysis.commit,
        analysis.status,
        analysis.analyzerVersion,
        JSON.stringify(analysis),
        analysis.createdAt,
        analysis.completedAt,
      ],
    );
    if (!result.rowCount) {
      throw new Error("Optimizer analysis ownership cannot be changed.");
    }
    return optimizerAnalysisFromDocument(result.rows[0].document);
  }

  async listQuestions(repository: string): Promise<RepositoryQuestionRecord[]> {
    const result = await this.pool.query<Row>(
      `SELECT document FROM repository_questions
       WHERE repository = $1 ORDER BY created_at`,
      [repository],
    );
    return result.rows.map(
      (row) => row.document as RepositoryQuestionRecord,
    );
  }

  async upsertQuestion(
    question: RepositoryQuestionRecord,
  ): Promise<RepositoryQuestionRecord> {
    const result = await this.pool.query<Row>(
      `INSERT INTO repository_questions (
        id, repository, question_key, status, document, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (repository, question_key) DO UPDATE SET
        updated_at = repository_questions.updated_at
      RETURNING document`,
      [
        question.id,
        question.repository,
        question.key,
        question.status,
        JSON.stringify(question),
        question.createdAt,
        question.updatedAt,
      ],
    );
    return result.rows[0].document as RepositoryQuestionRecord;
  }

  async answerQuestion(
    questionId: string,
    answer: NonNullable<RepositoryQuestionRecord["answer"]>,
    knowledge: RepositoryKnowledgeRecord,
  ): Promise<RepositoryQuestionRecord> {
    return await transaction(this.pool, async (client) => {
      const result = await client.query<Row>(
        `SELECT document FROM repository_questions
         WHERE id = $1 FOR UPDATE`,
        [questionId],
      );
      const question = result.rows[0]?.document as
        | RepositoryQuestionRecord
        | undefined;
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
      await client.query(
        `INSERT INTO repository_knowledge (
          id, repository, kind, document, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          knowledge.id,
          knowledge.repository,
          knowledge.kind,
          JSON.stringify(knowledge),
          knowledge.createdAt,
          knowledge.updatedAt,
        ],
      );
      await client.query(
        `UPDATE repository_questions
         SET status = 'answered', document = $2, updated_at = $3
         WHERE id = $1`,
        [questionId, JSON.stringify(question), answer.answeredAt],
      );
      return question;
    });
  }
}

function registrationFromRow(row: Row): RepositoryRegistration {
  return {
    id: String(row.id),
    repository: String(row.repository),
    cloneUrl: String(row.clone_url),
    defaultBranch: String(row.default_branch),
    installationId:
      row.installation_id === null ? undefined : Number(row.installation_id),
    localPath: row.local_path ? String(row.local_path) : undefined,
    schedule: {
      mode: row.schedule_mode as RepositoryRegistration["schedule"]["mode"],
      cron: row.schedule_cron ? String(row.schedule_cron) : undefined,
      timezone: String(row.schedule_timezone),
    },
    policy: {
      maxPullRequestsPerRun: Number(row.max_pull_requests_per_run),
      maxCiRepairAttempts: Number(row.max_ci_repair_attempts),
      allowMajorPackageUpdates: Boolean(row.allow_major_package_updates),
      automaticMerge: false,
    },
    nextRunAt: iso(row.next_run_at),
    lastRunAt: iso(row.last_run_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

export function assertMigrationCompatibility(
  available: Array<{ name: string; sha256: string }>,
  recorded: Array<{ name: string; sha256?: string }>,
): void {
  const known = new Map(available.map((migration) => [migration.name, migration.sha256]));
  const unknown = recorded.filter(({ name }) => !known.has(name));
  if (unknown.length) {
    throw new Error(`Database contains unavailable migrations: ${unknown.map(({ name }) => name).join(", ")}.`);
  }
  const modified = recorded.find(({ name, sha256 }) => sha256 && known.get(name) !== sha256);
  if (modified) throw new Error(`Applied migration ${modified.name} was modified.`);
}

export async function runMigrations(
  pool: Pool,
  directory = resolve("migrations"),
): Promise<string[]> {
  const applied: string[] = [];
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    sha256 text
  )`);
  await pool.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS sha256 text");
  const available = (await readdir(directory)).filter((entry) => entry.endsWith(".sql")).sort();
  const migrations = await Promise.all(available.map(async (name) => {
    const sql = await readFile(join(directory, name), "utf8");
    return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  }));
  const recorded = await pool.query<Row>("SELECT name, sha256 FROM schema_migrations");
  assertMigrationCompatibility(migrations, recorded.rows.map((row) => ({
    name: String(row.name), sha256: row.sha256 ? String(row.sha256) : undefined,
  })));
  for (const { name, sql, sha256 } of migrations) {
    await transaction(pool, async (client) => {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      const exists = await client.query(
        "SELECT sha256 FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (exists.rowCount) {
        const recordedSha = exists.rows[0].sha256 ? String(exists.rows[0].sha256) : undefined;
        if (recordedSha && recordedSha !== sha256) throw new Error(`Applied migration ${name} was modified.`);
        if (!recordedSha) await client.query("UPDATE schema_migrations SET sha256 = $2 WHERE name = $1", [name, sha256]);
        return;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)",
        [name, sha256],
      );
      applied.push(name);
    });
  }
  return applied;
}

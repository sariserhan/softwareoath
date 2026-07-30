import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type {
  ApprovalRecord,
  ControlPlaneStore,
  HostedRunRecord,
  IncidentRecord,
  RepositoryMapping,
  RunLogRecord,
  RunUpdate,
  FinalAttestation,
} from "./types";

type Row = QueryResultRow & Record<string, unknown>;

function iso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function runFromRow(row: Row): HostedRunRecord {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    repository: String(row.repository),
    commit: row.commit_sha ? String(row.commit_sha) : undefined,
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
    source: "sentry",
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
        `INSERT INTO approvals (id, run_id, decision, actor, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          approval.id,
          approval.runId,
          approval.decision,
          approval.actor,
          approval.reason,
          approval.createdAt,
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
          WHERE status IN ('received', 'retry_wait')
            AND cancel_requested = false
            AND attempts < max_attempts
            AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
            AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE runs
        SET attempts = attempts + 1, lease_owner = $2, lease_expires_at = $3,
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
}

export async function runMigrations(
  pool: Pool,
  directory = resolve("migrations"),
): Promise<string[]> {
  const applied: string[] = [];
  for (const name of (await readdir(directory))
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    await transaction(pool, async (client) => {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      const exists = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (exists.rowCount) return;
      await client.query(await readFile(join(directory, name), "utf8"));
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [name],
      );
      applied.push(name);
    });
  }
  return applied;
}

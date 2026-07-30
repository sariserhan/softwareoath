CREATE TABLE IF NOT EXISTS incidents (
  id text PRIMARY KEY,
  source text NOT NULL,
  external_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  priority text,
  url text,
  project text,
  release text,
  received_at timestamptz NOT NULL,
  payload_digest text NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents(id),
  repository text NOT NULL,
  commit_sha text,
  status text NOT NULL,
  decision text,
  repair_id text,
  pull_request_url text,
  branch text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS runs_claimable_idx
  ON runs (status, next_attempt_at, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id),
  decision text NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_decision_per_run
  ON approvals (run_id);

CREATE TABLE IF NOT EXISTS run_logs (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id),
  level text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS run_logs_run_created_idx
  ON run_logs (run_id, created_at);

CREATE TABLE IF NOT EXISTS repository_mappings (
  id text PRIMARY KEY,
  sentry_project text NOT NULL UNIQUE,
  repository text NOT NULL,
  clone_url text NOT NULL,
  default_branch text NOT NULL,
  installation_id bigint,
  local_path text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stewardship_repositories (
  id text PRIMARY KEY,
  repository text NOT NULL UNIQUE,
  clone_url text NOT NULL,
  default_branch text NOT NULL,
  installation_id bigint,
  local_path text,
  schedule_mode text NOT NULL,
  schedule_cron text,
  schedule_timezone text NOT NULL,
  max_pull_requests_per_run integer NOT NULL DEFAULT 1,
  max_ci_repair_attempts integer NOT NULL DEFAULT 2,
  allow_major_package_updates boolean NOT NULL DEFAULT false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS stewardship_repositories_due_idx
  ON stewardship_repositories (schedule_mode, next_run_at);

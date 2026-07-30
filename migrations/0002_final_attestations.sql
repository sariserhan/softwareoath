ALTER TABLE runs ADD COLUMN IF NOT EXISTS repair_commit_sha text;

CREATE TABLE IF NOT EXISTS final_attestations (
  id text PRIMARY KEY,
  run_id text NOT NULL UNIQUE REFERENCES runs(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

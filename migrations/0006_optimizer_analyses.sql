CREATE TABLE IF NOT EXISTS optimizer_analyses (
  id text PRIMARY KEY,
  tenant_key text NOT NULL,
  repository_id text NOT NULL REFERENCES stewardship_repositories(id) ON DELETE CASCADE,
  repository text NOT NULL,
  commit_sha text NOT NULL,
  status text NOT NULL,
  analyzer_version text NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS optimizer_analyses_repository_idx
  ON optimizer_analyses (repository_id, created_at DESC);

CREATE INDEX IF NOT EXISTS optimizer_analyses_commit_idx
  ON optimizer_analyses (repository_id, commit_sha, analyzer_version);

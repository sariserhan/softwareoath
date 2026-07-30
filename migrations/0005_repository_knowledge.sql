CREATE TABLE IF NOT EXISTS repository_knowledge (
  id text PRIMARY KEY,
  repository text NOT NULL,
  kind text NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS repository_knowledge_repository_idx
  ON repository_knowledge (repository, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS repository_questions (
  id text PRIMARY KEY,
  repository text NOT NULL,
  question_key text NOT NULL,
  status text NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (repository, question_key)
);

CREATE INDEX IF NOT EXISTS repository_questions_open_idx
  ON repository_questions (repository, status, created_at);

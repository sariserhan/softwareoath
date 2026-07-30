ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_user_id text,
  ADD COLUMN IF NOT EXISTS login text,
  ADD COLUMN IF NOT EXISTS authorization_repository text,
  ADD COLUMN IF NOT EXISTS authorization_permission text,
  ADD COLUMN IF NOT EXISTS authorization_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  login text NOT NULL,
  display_name text,
  avatar_url text,
  encrypted_access_token text NOT NULL,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx
  ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  action text NOT NULL,
  outcome text NOT NULL,
  provider text,
  provider_user_id text,
  login text,
  run_id text,
  repository text,
  detail text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_created_idx
  ON audit_events (created_at);

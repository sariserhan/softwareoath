CREATE TABLE IF NOT EXISTS service_heartbeats (
  service text NOT NULL CHECK (service IN ('api', 'worker')),
  instance_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready', 'stopping')),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (service, instance_id)
);
CREATE INDEX IF NOT EXISTS service_heartbeats_latest_idx ON service_heartbeats (service, observed_at DESC);

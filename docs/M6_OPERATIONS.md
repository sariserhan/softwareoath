# M6 production operations and security

This runbook defines the operational contracts that must be satisfied before private
beta. Repository automation provides the controls; production evidence must be
captured from the selected hosting, managed PostgreSQL, monitoring, and security-review
providers.

## Release and rollback

The protected release workflow verifies the repository, publishes digest-qualified
control-plane and runner images with provenance attestations, and sends an idempotent
deployment request. Manual rollback resolves an existing source-SHA tag back to both
immutable image digests and requires a written reason. Configure the deployment adapter,
production environment reviewers, and staging evidence described in
[RELEASE_OPERATIONS.md](RELEASE_OPERATIONS.md) before creating a release tag.

## Database recovery

The monthly Database recovery drill workflow exercises migrations, a custom-format
logical backup, SHA-256 manifest verification, isolated restoration, marker validation,
and post-restore migration readiness. Production additionally requires managed
PostgreSQL pooling, encrypted backups, point-in-time recovery, and a staging restore
record containing provider recovery point, recovery time, row-count checks, operator,
and timestamps. Never restore over the live connection string.

## Telemetry and alerts

Every API response carries X-Correlation-ID. API requests emit JSON
request.completed events with method, path, status, duration, and correlation ID;
unhandled failures also emit request.failed. Workers emit structured lifecycle and
heartbeat failures, while durable per-run logs retain repair progress.
Telemetry records pathname only and excludes query strings, request bodies, and headers.

Authenticated GET /metrics returns Prometheus text for run status, active and
retry-wait queues, repository count, and worker-heartbeat age. Monitoring must retain
logs and metrics without repository source, tokens, request bodies, patches, or secret
environment values.

Minimum production alerts:

- /ready fails for two consecutive minutes;
- worker heartbeat age exceeds 60 seconds;
- retry-wait or active runs rise continuously for 15 minutes;
- blocked or CI-failed run rate exceeds the established seven-day baseline;
- deployment or rollback fails;
- database connections approach 80% of the configured pool/provider limit;
- artifact integrity verification or receipt-signature verification fails;
- authentication, webhook-signature, CSRF, or rate-limit denials spike.

The on-call dashboard must link each alert to correlated logs, deployment ID, immutable
image digests, queue state, database health, and this runbook.

## Incident response

1. Declare an incident, record the correlation/deployment IDs, and stop new releases.
2. Use /live, /ready, /metrics, worker heartbeat, queue telemetry, and audit export
   to establish scope without editing the database.
3. Cancel unsafe work through the operator API. Preserve leases and artifacts.
4. Roll back application images only when the previous release is schema-compatible.
5. For data corruption, stop writers and restore into a new database; validate before
   switching the connection string.
6. Rotate or revoke affected credentials and signing keys.
7. Preserve logs, audit records, failed artifacts, commands, and timestamps.
8. Publish a blameless review with detection, containment, recovery, and follow-up.

## Signing-key lifecycle

Private Ed25519 keys live only in the production secret/KMS service and the
credential-bearing signer process. They never enter runner environments, images,
artifacts, logs, or source control. Key IDs are unique and time-scoped.

Rotation is expand-then-switch: add the new public key, deploy all verifiers, switch the
active private key and ID, verify a new receipt, and retain old public keys for the full
evidence-retention period. Recovery uses an offline-authorized replacement key and the
same procedure.

For compromise, add the key ID immediately to
SOFTWARE_OATH_RECEIPT_REVOKED_KEY_IDS, remove/disable its private key in the secret
service, deploy all trust boundaries, and investigate every receipt signed by it. The
application refuses to sign with a revoked active key and removes revoked public keys
from the trusted ring, so affected historical evidence fails closed. Record the
revocation time, cause, owner, affected receipts, and replacement key.

## OAuth and webhook security review

GitHub OAuth access tokens are AES-256-GCM encrypted with a separately managed master
key before persistence. Browser cookies contain only opaque session IDs and are
HttpOnly, SameSite=Lax, Secure on HTTPS, and time-bounded. OAuth state is HMAC-signed,
cookie-bound, and expires after ten minutes; the state cookie is cleared when the
session is created. Decisions require a per-session CSRF token and a fresh GitHub
permission check.

Sentry and generic webhook signatures are checked over the raw bounded body with
constant-time comparison before JSON parsing. Incidents have a durable unique
(source, external_id) boundary. Providers without event IDs use the exact payload
SHA-256 as the external ID, so replayed deliveries return the prior run and are not
dispatched again. Rotate webhook secrets through the provider and secret manager;
signature failures must be monitored.
An adapter without its signing secret is disabled and returns 404; unsigned fallback is
not permitted.

## Idempotency contract

- Webhooks deduplicate at the durable incident uniqueness boundary.
- Scheduled runs use repository and scheduled-minute identity.
- Owner decisions replay only when decision, reason, and immutable reviewer ID match
  the original attestation; conflicts remain rejected.
- Repair PR delivery finds an existing PR for the deterministic owner/branch/base tuple
  before creating one.
- Queue wake-ups and deployment requests carry stable idempotency keys.
- Automatic claims use leases and FOR UPDATE SKIP LOCKED; operator retry is a
  conditional state transition, so repeated requests cannot reset an active run.

## External completion evidence

Current non-secret production evidence is tracked in
[M6_EVIDENCE.md](M6_EVIDENCE.md).

Attach these records to the M6 release:

- successful staging deploy and rollback through the protected environment;
- managed PostgreSQL backup/PITR restore and integrity report;
- monitoring screenshots or exports proving alert delivery;
- signing-key rotation and emergency-revocation exercise;
- OAuth/webhook review sign-off;
- independent security assessment with no unresolved critical/high finding.

Copy [m6-evidence.example.json](m6-evidence.example.json), replace every placeholder
with links and values from the real exercises, and verify the completed record:

    npm run m6:readiness -- /secure/m6-evidence.json

The command exits nonzero unless all external gates are present, immutable image
references are digest-qualified, and the independent review reports zero unresolved
critical or high findings. Do not commit confidential reports or provider credentials.

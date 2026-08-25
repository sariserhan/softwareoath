# Connected pilot deployment

The hosted control plane is event-driven on Vercel:

- Vercel Functions handle repository registration, owner triggers, webhooks, history, and decisions.
- Vercel Queues wakes a bounded worker function only when a durable run exists.
- A protected Vercel Cron invocation every 15 minutes discovers due schedules and refreshes pending GitHub CI state.
- Neon PostgreSQL remains authoritative for leases, retries, logs, mappings, and approvals.
- Private Vercel Blob stores evidence and repair artifacts.
- On-demand Vercel Sandbox microVMs execute untrusted repository commands from a
  private VCR image pinned by immutable digest.

There is no continuously polling hosted worker. `npm run worker` remains available only for local or self-hosted compatibility. Queue delivery is at least once; PostgreSQL claims and leases remain the exactly-once processing boundary.

Hosted deployments require `SOFTWARE_OATH_SANDBOX_IMAGE` with a private VCR image
reference pinned as `@sha256:<digest>`. Generic verification Sandboxes have no
network access. Infracost credentials are injected by Sandbox network policy only
for the Infracost API hosts and are never exposed inside the microVM. The legacy
runner broker variables are ignored on Vercel and retained only for local or
self-hosted compatibility.

## Local production-shaped stack

1. Copy `.env.example` to `.env`.
2. Generate `SOFTWARE_OATH_MASTER_KEY` with `openssl rand -base64 32`.
3. Generate `SOFTWARE_OATH_APPROVAL_TOKEN` with `openssl rand -hex 32`.
4. Generate a separate `SOFTWARE_OATH_SESSION_SECRET` with
   `openssl rand -hex 32`.
5. Create a GitHub OAuth App with callback URL
   `https://app.softwareoath.com/api/auth/github/callback`, then configure
   `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.
6. Run `npm run receipt:keygen -- receipt-2026-07`, store the generated private
   key in your secrets manager, and configure:
   - `SOFTWARE_OATH_RECEIPT_KEY_ID` with the generated key ID.
   - `SOFTWARE_OATH_RECEIPT_PRIVATE_KEY` with its PKCS8 private key.
   - `SOFTWARE_OATH_RECEIPT_PUBLIC_KEYS` as a JSON object mapping every trusted
     key ID to its SPKI public key.
7. Create an Infracost API key for the authorized organization and set
   `INFRACOST_API_KEY`. Enabling it permits the isolated cost container to send
   infrastructure-derived data to Infracost and download provider plugins.
8. Keep `SOFTWARE_OATH_OPTIMIZER_ANALYSIS_ENABLED=false` until the remaining O1
   isolation and required M6 controls are operational. Setting it to `true`
   enables the experimental tracked-file static reader for registered stewardship
   scans; it does not enable repository modification.
9. Optionally set `SENTRY_CLIENT_SECRET` to enable the legacy Sentry adapter.
10. Start Docker Desktop.
11. Run `docker compose up --build`.

The local stack builds `software-oath-runner:local` automatically and connects
ephemeral runners through the named `software-oath-workspaces` volume. Hosted
workers fail closed when no runner image is configured. See
[RUNNER_SECURITY.md](RUNNER_SECURITY.md) for the isolation contract and
production requirements.

`SOFTWARE_OATH_APPROVAL_TOKEN` is an operator credential for cancellation and
repository mapping only. It cannot approve or reject repairs.

Reviewers sign in through GitHub. Access tokens are AES-256-GCM encrypted in
server-side sessions and never placed in browser cookies. Sessions use opaque,
HttpOnly, SameSite cookies, expire after eight hours, and require a per-session
CSRF token for decisions. Immediately before a decision, Software Oath asks
GitHub whether the authenticated user has `admin`, `maintain`, or `push`
permission on that run's repository.

Repair receipts use canonical JSON and Ed25519. Review, apply, artifact
persistence, pull-request delivery, and human approval reject unsigned receipts,
unknown key IDs, and altered payloads.

When a reviewer approves or rejects a run, the API atomically stores the decision
and a second Ed25519-signed final attestation. That document binds the incident
digest, base and repair commits, branch and PR URL, verification outcome, repair
receipt digest/signature, reviewer identity, written reason, and decision time.
Retrieve it with:

```bash
curl https://app.softwareoath.com/api/runs/RUN_ID/receipt
```

The worker includes this URL in the draft pull request when
`SOFTWARE_OATH_PUBLIC_URL` is configured.

Authentication attempts, denied decisions, successful decisions, and logout
events are stored in the control-plane audit log. The final attestation records
the immutable GitHub user ID, login, repository permission, and authorization
timestamp; the browser cannot supply or override reviewer identity.

### Rotate receipt keys

1. Generate a new key with a new ID.
2. Add its public key to `SOFTWARE_OATH_RECEIPT_PUBLIC_KEYS` on both API and worker.
3. Deploy the expanded public-key ring.
4. Switch the worker's private key and active key ID.
5. Keep retired public keys in the ring for as long as their receipts must verify.

Never remove the old public key before the retention period for its signed
receipts ends.

For emergency compromise, add the affected ID to the comma-separated
SOFTWARE_OATH_RECEIPT_REVOKED_KEY_IDS denylist and remove its private key from the
secret service. Revoked IDs cannot sign or verify. Follow the evidence-preserving
procedure in [M6_OPERATIONS.md](M6_OPERATIONS.md).

The API and worker perform a read-only schema readiness check and never apply migrations
on request or worker cold starts. `npm run migrate:deploy` runs once in the production
Vercel build before compilation; preview builds skip schema mutation. Migrations are
serialized with a PostgreSQL advisory lock. PostgreSQL and repair artifacts use named
persistent volumes.

## GitHub App

Generate the least-privilege manifest:

```bash
software-oath github-manifest https://app.softwareoath.com
```

Submit it through GitHub's App Manifest flow. Convert the temporary callback code:

```bash
export SOFTWARE_OATH_MASTER_KEY="<base64 key>"
software-oath github-convert "<temporary code>"
```

This writes the private key, webhook secret, and client secret as authenticated
AES-256-GCM ciphertext in `.software-oath/github-app.json` with mode `0600`.
Install the App using the URL printed by the command.

The App uses Contents write, Pull requests write, and Metadata read. Software Oath
creates draft PRs and never merges them.

## Register a repository

Sentry is optional and not part of the stewardship loop. For normal operation,
register repositories directly:

```bash
curl -X POST https://app.softwareoath.com/api/repositories \
  -H "Authorization: Bearer $SOFTWARE_OATH_APPROVAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "acme/storefront",
    "cloneUrl": "https://github.com/acme/storefront.git",
    "defaultBranch": "main",
    "installationId": 123456,
    "schedule": {
      "mode": "weekly",
      "timezone": "America/New_York"
    },
    "policy": {
      "maxPullRequestsPerRun": 1,
      "maxCiRepairAttempts": 2,
      "allowMajorPackageUpdates": false
    }
  }'
```

Schedule modes are `disabled`, `daily`, `weekly`, or `custom`. Custom schedules
use a five-field cron expression. Owners can start a scan at any time from the
authenticated dashboard or `POST /api/repositories/:owner/:repo/scan`.

Every scan refreshes a persistent commit-keyed memory file under the artifact
store. It records structure, manifests, lockfiles, CI workflows, tests,
validation commands, findings, and the last 52 scan summaries.

## Optional Sentry adapter

```bash
curl -X POST https://app.softwareoath.com/api/mappings \
  -H "Authorization: Bearer $SOFTWARE_OATH_APPROVAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sentryProject": "storefront",
    "repository": "acme/storefront",
    "cloneUrl": "https://github.com/acme/storefront.git",
    "defaultBranch": "main",
    "installationId": 123456
  }'
```

Configure the Sentry Integration webhook as
`https://app.softwareoath.com/webhooks/sentry`. Its release value must resolve to a
Git commit in the mapped repository.

## Live pilot checklist

Use one non-production GitHub repository and one Sentry project:

1. Commit a narrow `software-oath.yml` and a reproducible failing fixture.
2. Install the GitHub App and create the Sentry-to-GitHub mapping above.
3. Send a signed Sentry webhook containing the exact failing release commit.
4. Confirm the worker creates a signed receipt and draft PR without manual
   database edits.
5. Alter a copy of `receipt.json` and confirm review, apply, and approval reject it.
6. Record an identified approval with a written reason.
7. Download `GET /api/runs/:id/receipt` and retain the run ID, PR URL, repair and
   final-attestation key IDs, commits, and timestamps as pilot evidence.

## Worker guarantees

- PostgreSQL claims use a transaction and `FOR UPDATE SKIP LOCKED`.
- Leases are exclusive and stale leases are recoverable.
- Failures retry with exponential backoff capped at one hour.
- Operators can request cancellation.
- Every lifecycle transition creates a durable log.
- Patches and receipts survive disposable-checkout cleanup.
- GitHub credentials are short-lived installation tokens.
- Repository commands can execute in a constrained Docker sandbox.

For hosted operation, replace Docker with short-lived microVMs and the local
artifact volume with encrypted object storage.

## Operational probes and shutdown

`GET /live` (and the compatibility alias `GET /health`) reports process liveness
without depending on PostgreSQL or the worker. `GET /ready` succeeds only when the
control-plane store responds and the newest durable worker heartbeat is ready and no
older than 60 seconds. Load balancers must use `/ready` for traffic admission and
`/live` only for process restart decisions.

Self-hosted API and worker instances publish durable ready/stopping heartbeats every ten seconds. Vercel Functions are request-scoped and therefore do not publish process heartbeats; hosted readiness relies on PostgreSQL health, queue delivery telemetry, and the cron execution history.
`SIGTERM` and `SIGINT` stop new loop work, publish stopping state, close the HTTP listener,
and drain PostgreSQL connections. An interrupted job retains its lease; after expiry, the
existing exclusive claim path recovers it with persisted attempt and bounded backoff state.
Readiness age must remain greater than twice the configured heartbeat interval.

## Operator recovery and housekeeping

Operator routes require `Authorization: Bearer $SOFTWARE_OATH_APPROVAL_TOKEN`; this
token cannot approve repairs. `POST /api/runs/{runId}/retry` requires a written reason
and resets only blocked, cancelled, or CI-failed runs. It clears stale lease/error state,
resets attempts, and records an audit event. Cancellation is also audited.

`POST /api/admin/garbage-collection` removes expired authentication sessions and service
heartbeats older than 24 hours, returning exact counts and recording the operation.
`GET /api/admin/audit?repository=owner/repository` exports chronological repository-scoped
audit records and audits the export itself. These operations avoid direct database editing.
Customer repository deletion is a separate M6 gate and must also cover artifacts and backups.

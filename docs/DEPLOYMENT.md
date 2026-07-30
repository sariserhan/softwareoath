# Connected pilot deployment

Software Oath needs two long-running processes and PostgreSQL:

- `api`: Sentry ingestion, run history, decisions, mappings, and dashboard.
- `worker`: durable claims, checkout, repair, verification, artifact persistence,
  branch push, and draft pull-request publication.
- `postgres`: incidents, leases, retries, logs, mappings, and approvals.

This workload is not suitable for request-only serverless hosting. Use a trusted
container host or VM with persistent PostgreSQL and artifact storage.

## Local production-shaped stack

1. Copy `.env.example` to `.env`.
2. Generate `SOFTWARE_OATH_MASTER_KEY` with `openssl rand -base64 32`.
3. Generate `SOFTWARE_OATH_APPROVAL_TOKEN` with `openssl rand -hex 32`.
4. Generate a separate `SOFTWARE_OATH_SESSION_SECRET` with
   `openssl rand -hex 32`.
5. Create a GitHub OAuth App with callback URL
   `https://oath.example.com/api/auth/github/callback`, then configure
   `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.
6. Run `npm run receipt:keygen -- receipt-2026-07`, store the generated private
   key in your secrets manager, and configure:
   - `SOFTWARE_OATH_RECEIPT_KEY_ID` with the generated key ID.
   - `SOFTWARE_OATH_RECEIPT_PRIVATE_KEY` with its PKCS8 private key.
   - `SOFTWARE_OATH_RECEIPT_PUBLIC_KEYS` as a JSON object mapping every trusted
     key ID to its SPKI public key.
7. Set `SENTRY_CLIENT_SECRET`.
8. Start Docker Desktop.
9. Run `docker compose up --build`.

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
curl https://oath.example.com/api/runs/RUN_ID/receipt
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

The API and worker apply pending migrations before accepting work. PostgreSQL and
repair artifacts use named persistent volumes.

## GitHub App

Generate the least-privilege manifest:

```bash
software-oath github-manifest https://oath.example.com
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

## Map Sentry to GitHub

```bash
curl -X POST https://oath.example.com/api/mappings \
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
`https://oath.example.com/webhooks/sentry`. Its release value must resolve to a
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

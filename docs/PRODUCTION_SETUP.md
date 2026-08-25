# Production setup for softwareoath.com

Software Oath uses two public origins:

- `https://softwareoath.com` — product website, documentation, trust, and install entry point.
- `https://app.softwareoath.com` — authenticated dashboard, control-plane API,
  GitHub OAuth, GitHub App webhooks, repair receipts, and owner actions.

The dashboard and API deliberately share one origin. This keeps session cookies
first-party and avoids adding cross-origin trust to owner decisions.

## 1. DNS and TLS

Create these records with the DNS provider for `softwareoath.com`:

| Name | Type | Target |
| --- | --- | --- |
| `@` | `A`, `AAAA`, or provider alias | The product website host |
| `www` | `CNAME` | `softwareoath.com` |
| `app` | `CNAME` or provider alias | The container ingress/load balancer |

The exact targets come from the selected hosting providers; do not invent them.
Redirect `www.softwareoath.com` to `https://softwareoath.com`. Provision valid
TLS certificates for the apex, `www`, and `app` names, redirect HTTP to HTTPS,
and enable HSTS only after all subdomains are confirmed HTTPS-capable.

## 2. Deploy the control plane

Software Oath needs:

- one API/dashboard container;
- one durable worker container;
- PostgreSQL;
- encrypted persistent artifact storage;
- an isolated Docker or microVM runner for untrusted repository commands.

Start from [`.env.production.example`](../.env.production.example). Store all
secret values in the hosting platform's secret manager, not in an `.env` file
committed to Git.

The production origin must be:

```dotenv
SOFTWARE_OATH_PUBLIC_URL=https://app.softwareoath.com
SOFTWARE_OATH_DASHBOARD_ORIGIN=https://app.softwareoath.com
```

Expose container port `8787` behind the HTTPS ingress. Health checks should call
`GET /health`.

## 3. Configure owner authentication

Create the GitHub OAuth application with:

- Homepage URL: `https://softwareoath.com`
- Authorization callback URL:
  `https://app.softwareoath.com/api/auth/github/callback`

Store its client ID and secret as `GITHUB_OAUTH_CLIENT_ID` and
`GITHUB_OAUTH_CLIENT_SECRET`.

## 4. Create the GitHub App

Generate the manifest:

```bash
software-oath github-manifest https://app.softwareoath.com
```

The current connected setup uses the CLI conversion command after GitHub returns
the temporary manifest code:

```bash
software-oath github-convert "<temporary-code>"
```

The generated GitHub App should use:

- Homepage URL: `https://softwareoath.com`
- Webhook URL: `https://app.softwareoath.com/webhooks/github`
- Contents: read and write
- Pull requests: read and write
- Metadata: read
- Events: installation, installation repositories, and push

Only install it on repositories explicitly selected by the owner. Software Oath
may push a repair branch and open a draft pull request; it never merges.

The webhook receiver and in-product manifest callback are the next connected
milestone. Until those endpoints are implemented, repository registration uses
the installation ID through the authenticated/operator registration flow.

## 5. First repository proof

Use a disposable repository owned by the Software Oath organization:

1. Install the GitHub App on only that repository.
2. Register its installation ID and weekly schedule.
3. Trigger the first scan from the owner dashboard.
4. Confirm the scan writes technical knowledge and onboarding questions.
5. Answer the questions as a GitHub user with write access.
6. Add one safe outdated dependency with a passing test suite.
7. Trigger a new scan.
8. Confirm Software Oath creates a bounded patch, signed receipt, repair branch,
   and draft pull request.
9. Confirm CI passes and Software Oath does not merge the pull request.

This is the release gate for calling the connected stewardship loop operational.

## 6. Production security checklist

- Use Node.js 24 LTS, or at minimum Node.js 22.12.
- Use independent random values for approval, session, master, and signing keys.
- Keep receipt public keys after signing-key rotation.
- Back up PostgreSQL and signed artifacts.
- Do not mount the host Docker socket in a multi-tenant production deployment;
  use an isolated runner boundary.
- Rate-limit authentication, webhook, scan, and answer endpoints at ingress.
- Restrict `/api/repositories` registration to authenticated installation owners
  before public onboarding.
- Monitor health, worker lease age, queue depth, failed runs, and unsigned-receipt
  rejection without making an external error tracker a product dependency.


## Database migration and recovery policy

Migrations are immutable, ordered, forward-only files. The control plane records a SHA-256
for every applied migration and refuses startup when an applied migration is missing from the
release or its contents changed. Schema changes must remain compatible with the preceding API
and worker release during rolling deployment: expand first, deploy readers/writers, backfill,
and remove old fields only in a later release.

Application rollback means redeploying the preceding image while retaining the expanded schema.
Destructive schema rollback is prohibited during an incident. If a migration corrupts data, stop
writers and restore the verified pre-deployment backup into a new database, run migrations with
the target release, validate readiness and record counts, then switch the connection string.

Create a custom-format backup and SHA-256 manifest with:

```bash
DATABASE_URL=... npm run db:recovery -- backup /secure/software-oath.dump
```

Exercise restoration only into an isolated database:

```bash
RESTORE_DATABASE_URL=... npm run db:recovery -- restore /secure/software-oath.dump
```

The restore command verifies the manifest and refuses when `RESTORE_DATABASE_URL` equals the
live `DATABASE_URL`. Production must use managed PostgreSQL point-in-time recovery in addition
to these logical backups. A staging restore exercise with recorded recovery point and recovery
time remains required before the managed PostgreSQL roadmap control can be completed.

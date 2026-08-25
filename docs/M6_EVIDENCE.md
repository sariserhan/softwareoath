# M6 production evidence

This record contains non-secret evidence collected from the production Software Oath
stack on 2026-08-25. Confidential provider reports and credentials remain outside the
repository.

## Production topology

- Application: Vercel project `ssari/softwareoath`
- Production application origin: `https://app.softwareoath.com`
- Database: owned Neon marketplace resource `neon-emerald-zebra`, connected to the
  Vercel production and preview environments
- Artifact storage: private Vercel Blob
- Isolated execution: Vercel Sandbox with a production image configured

## Verified controls

### Deployment and rollback

- Current deployment: `dpl_8AdsGA1qmfszTuawXdCfwPNJKtNd`
  (`softwareoath-1adzuebc3-ssari.vercel.app`, commit `eb5d7f6`)
- Previous deployment: `dpl_HUEzHaCAWfnRz2RbtS7P1sFyck36`
  (`softwareoath-81chmykj7-ssari.vercel.app`, commit `2cfc480`)
- Rollback event: `uev_2h8rEkGnNOL6aqDE8YJoVIEQ` at
  `2026-08-25T17:53:14.481Z`
- Restoration event: `uev_xiu1LqTpjxi88ZuUefNtxXwm` at
  `2026-08-25T17:53:20.205Z`
- During rollback, `/live` and `/ready` both returned HTTP 200 with valid TLS.
- After restoring the current deployment, both endpoints again returned HTTP 200.
- The missing `app.softwareoath.com` alias was attached to the active deployment and
  its root, liveness, and readiness endpoints were verified.

### Logical recovery drill

The isolated PostgreSQL recovery workflow passed on commit `eb5d7f6`:

- Run: [Database recovery drill 32878578305](https://github.com/sariserhan/softwareoath/actions/runs/32878578305)
- Started: `2026-08-25T17:33:31Z`
- Completed: `2026-08-25T17:34:33Z`
- Evidence: migrations applied, recovery marker created, custom-format backup created,
  SHA-256 manifest verified, backup restored into a separate PostgreSQL service,
  marker validated, and post-restore migration readiness confirmed.

### CI, security, and monitoring

- CI run `32878579380` passed lint, 219 tests, build, migrations, and container build.
- Security run `32878579378` passed dependency, secret, control-plane image, and runner
  image scans.
- Vercel recorded and resolved a real `5xx status codes` error-anomaly alert beginning
  at `2026-08-25T06:17:20Z`.
- The project default alert rule subscribes owners and project administrators to error
  and critical events.
- Alert group `ag_01a03790-ee5d-7e8c-961e-d53fb01b244e` recorded six production 503
  responses on `/api/control-plane`, correlated five sample request IDs with the
  responsible deployment and logs, and resolved after 15 minutes.
- Vercel recorded `emailPublishedAt=2026-08-25T06:20:51.305Z` for that group, proving
  the owner notification was published through the default alert rule.

## Remaining external evidence

M6 is not complete until all of the following are attached:

- a Neon point-in-time or managed-backup restore into an isolated Neon branch, including
  recovery point, recovery duration, and integrity checks;
- delivered readiness, stale-worker, queue-saturation, and deployment-failure alerts,
  plus a recorded full incident runbook exercise;
- a second trusted production deployment reviewer;
- an independent security assessment with zero unresolved critical/high findings.

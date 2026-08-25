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

### Production-to-Neon recovery drill

A production logical backup was restored into a separately configured Neon database
on `2026-08-25`:

- Recovery point: `2026-08-25T18:58:00Z`
- Restore completed: `2026-08-25T18:58:07.249Z`
- Recovery time: 7 seconds (2-second backup and 4-second restore, rounded)
- Client/server version: PostgreSQL 18
- Backup format: PostgreSQL custom format, 52,076 bytes
- Backup SHA-256: `d8f54c382d6f4c4dde5a83a071599eeec9e933cfe01a0d43ffff02fe2837c8f8`
- Integrity evidence: all 23 application tables and 99 rows were compared between
  production and the isolated restore; table sets and exact per-table row counts
  matched with zero mismatches.
- Safety evidence: the source and restore connection strings resolved to distinct
  Neon endpoints, and production was read only throughout the exercise.

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
- The scheduled `Production health` workflow independently probes the public liveness
  and readiness contracts every five minutes and retains its result as an artifact.
- Its first external probe passed in
  [run 32881011674](https://github.com/sariserhan/softwareoath/actions/runs/32881011674)
  on commit `180873f`.

### Production incident exercise

The production runbook was exercised across the deployment and database recovery
controls on `2026-08-25`:

- Detection: Vercel anomaly group `ag_01a03790-ee5d-7e8c-961e-d53fb01b244e`
  identified six correlated production 503 responses and published an owner email.
- Scope: deployment `dpl_8AdsGA1qmfszTuawXdCfwPNJKtNd`, correlated request IDs,
  `/live`, `/ready`, and deployment logs were inspected without editing production data.
- Containment and application recovery: production was rolled back to deployment
  `dpl_HUEzHaCAWfnRz2RbtS7P1sFyck36`, health was verified, and the current deployment
  was restored; both transitions retained HTTP 200 liveness and readiness.
- Data recovery: a production logical backup was restored into a distinct Neon
  database in 7 seconds and all 23 tables and 99 rows matched exactly.
- Independent verification: [Production health run 32887257064](https://github.com/sariserhan/softwareoath/actions/runs/32887257064)
  passed against commit `b2fd508` from `2026-08-25T19:02:10Z` through
  `2026-08-25T19:02:15Z` and retained its result artifact.
- Runtime applicability: production readiness reports `execution=event_driven`; this
  Vercel deployment has no continuously running worker whose heartbeat could become
  stale. Worker-heartbeat alerts remain required for self-hosted worker deployments.

## Remaining external evidence

M6 is not complete until all of the following are attached:

- a provider-native Neon point-in-time or managed-backup restore into an isolated
  branch (the production logical restore above proves application-level recovery but
  does not exercise Neon PITR);
- delivered readiness, queue-saturation, and deployment-failure alerts (plus
  stale-worker delivery if a continuously running worker is deployed), owner-parked
  on `2026-08-25`;
- a second trusted production deployment reviewer, owner-deferred until private beta
  on `2026-08-25` while the service has a single operator;
- an independent security assessment with zero unresolved critical/high findings,
  owner-deferred until private beta on `2026-08-25`.

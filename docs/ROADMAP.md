# Software Oath product roadmap

## Completion target

A repository owner can sign in with GitHub, install the App, select a repository,
create or review its oath, run a scan, authorize a bounded repair, receive a
verified draft pull request, inspect its evidence and CI, and record a signed
approval or rejection—without CLI commands, manual API calls, or database edits.

Software Oath never approves or merges its own pull request.

## Release principles

- Evidence outranks agent claims.
- Hosted execution fails closed without isolation or required evidence.
- The API and worker do not execute customer repository code.
- Production screens never silently fall back to demo data.
- Ecosystem recognition is not active stewardship support.
- Prove one narrow workflow end to end before expanding breadth.

## Milestones

| Milestone | Outcome | Priority | Depends on |
| --- | --- | --- | --- |
| M0 | Reproducible green baseline | P0 | None |
| M1 | Mandatory isolated execution | P0 | M0 |
| M2 | Proven npm-to-draft-PR path | P0 | M1 |
| M3 | Customer GitHub onboarding | P0 | M0 |
| M4 | Live connected dashboard | P0 | M2, M3 |
| M5 | Owner review and final attestation | P1 | M4 |
| M6 | Production operations and security | P1 | M1–M5 |
| M7 | Private beta readiness | P1 | M6 |
| M8 | Additional ecosystem adapters | P2 | M7 |

## M0 — Reproducible green baseline

**Objective:** A fresh checkout installs, tests, builds, and packages repeatably.

- [x] Run `npm ci` from a clean checkout.
- [x] Fix all lint, test, TypeScript, and Vite build failures.
- [x] Smoke-test every CLI command.
- [x] Start the documented Docker Compose stack.
- [x] Apply migrations to a fresh PostgreSQL database.
- [x] Gate CI on install, lint, tests, build, migrations, and Docker image build.
- [x] Replace static status badges with CI-backed badges.
- [x] Pin and document supported Node.js versions.

**Exit:** A fresh clone passes CI and the full local stack becomes healthy without
manual repair.

## M1 — Mandatory isolated execution

**Objective:** Customer code cannot run in the API or worker process.

- [x] Remove the hosted fallback to local execution.
- [x] Refuse jobs when an isolated runner is unavailable.
- [x] Add a dedicated ephemeral runner boundary.
- [x] Remove Docker socket exposure from the credential-bearing worker.
- [x] Enforce CPU, memory, process, output, and time limits.
- [ ] Enforce a workspace disk quota.
- [x] Disable network by default and authorize validated npm preparation separately.
- [x] Use short-lived repository-scoped GitHub credentials.
- [x] Keep service and signing credentials out of customer jobs.
- [x] Redact common credentials and private keys from command and agent output.
- [x] Validate paths and symlinks, reject submodules, and avoid archive extraction.
- [x] Destroy runner containers after every terminal state.
- [x] Record the resolved runner image digest in verification receipts.
- [x] Test bounded process exhaustion.
- [x] Test timeouts and forced container cleanup.
- [x] Test excessive output truncation.
- [ ] Test workspace disk exhaustion.
- [x] Test symlink and path escape.
- [x] Test service-credential isolation.
- [x] Test lifecycle-script disabling in npm preparation and repair.
- [x] Test network denial.
- [x] Test expired worker-lease recovery.

**Exit:** Hosted execution cannot start without isolation, and adversarial tests
demonstrate containment and cleanup.

## M2 — Proven npm-to-draft-PR path

**Objective:** Repeatedly complete one narrow TypeScript/npm workflow.

- [x] Create a dedicated GitHub end-to-end test repository.
- [x] Register it and scan an immutable default-branch commit.
- [x] Detect an npm patch/minor update or security advisory.
- [x] Produce a lockfile-only update with lifecycle scripts disabled.
- [x] Enforce exact allowed paths and protect `software-oath.yml`.
- [x] Run all oath checks in the isolated runner.
- [x] Prove the finding disappeared and no blocking finding appeared.
- [x] Sign and persist the repair receipt.
- [x] Push one repair commit and open a draft PR.
- [x] Monitor required GitHub checks.
- [x] Expose review only after CI succeeds.
- [x] Automate the workflow as an end-to-end test.
- [x] Cover missing oath.
- [x] Cover registry failure.
- [x] Cover repair timeout.
- [x] Cover an empty patch.
- [x] Cover an out-of-scope patch.
- [x] Cover unresolved findings.
- [x] Cover signature failure.
- [x] Cover GitHub failure.
- [x] Cover failed CI.

**Exit:** The scenario succeeds repeatedly without manual state changes, and no
failed-evidence repair can reach approval.

## M3 — Customer GitHub onboarding

**Objective:** An owner connects a repository entirely in the browser.

- [x] Build GitHub sign-in and callback.
- [x] Build GitHub App installation and callback.
- [x] List accessible organizations and repositories.
- [x] Validate live permission before registration.
- [x] Detect installation, clone URL, and default branch.
- [x] Build repository, schedule, and repair-policy settings.
- [x] Generate an initial oath from repository evidence.
- [x] Add an oath editor with schema validation and rendered summary.
- [x] Commit or propose the initial oath safely.
- [x] Start the first scan and show progress.
- [x] Handle revoked installation, missing permission/oath, unsupported repository,
  expired session, failed scan, and disconnected states.

**Exit:** A new owner connects a repository and starts its first scan without
internal credentials or manual API calls.

## M4 — Live connected dashboard

**Objective:** Every production view uses authoritative server data.

- [ ] Create a shared typed, versioned API client.
- [ ] Standardize auth, errors, pagination, retries, and correlation IDs.
- [ ] Provide APIs for sessions, installations, repositories, settings, oath,
  incidents, findings, runs, logs, patches, evidence, CI, knowledge, questions,
  decisions, attestations, replays, and analytics.
- [ ] Replace demo data in every dashboard view.
- [ ] Keep examples only behind explicit demo mode.
- [ ] Remove silent demo fallback after API failures.
- [ ] Add loading, empty, error, disconnected, permission-denied, stale, and
  retrying states.

**Exit:** A production build contains no implicit demo fallback, routes restore
from server state, and UI tests cover every state.

## M5 — Owner review and final attestation

**Objective:** An authorized owner can understand and decide a repair in one view.

- [ ] Show finding importance, evidence, provenance, commits, full patch, changed
  files, scope result, commands, durations, findings delta, CI, agent, runner,
  image, and receipt signature.
- [ ] Link directly to the draft PR.
- [ ] Require a written approval or rejection reason.
- [ ] Recheck live GitHub permission at decision time.
- [ ] Require CSRF validation.
- [ ] Disable approval for blocked, incomplete, pending/failed CI, or invalid
  signature states.
- [ ] Prevent duplicate or conflicting decisions.
- [ ] Atomically store the decision, audit event, and final attestation.
- [ ] Verify final attestations in both UI and CLI.

**Exit:** Authorized decisions work, unauthorized decisions fail, and the complete
decision can be reconstructed and cryptographically verified.

## M6 — Production operations and security

**Objective:** Operate, recover, observe, and support the service safely.

- [ ] Automate production deployments, releases, and rollback.
- [ ] Use managed PostgreSQL with pooling and tested backup restoration.
- [ ] Use durable artifact storage with retention and integrity controls.
- [ ] Define migration compatibility and rollback policy.
- [ ] Add health, readiness, worker heartbeat, stale-lease recovery, graceful
  shutdown, and in-flight job recovery.
- [ ] Make webhooks, schedules, decisions, PR creation, and retries idempotent.
- [ ] Add administrative retry, cancellation, and garbage collection.
- [ ] Add rate limiting, bounded bodies, backoff, and saturation tests.
- [ ] Add structured logs, metrics, tracing, error monitoring, alerts, dashboards,
  and incident runbooks.
- [ ] Publish a threat model.
- [ ] Define signing-key storage, rotation, revocation, and recovery.
- [ ] Review OAuth token encryption and webhook replay protection.
- [ ] Add dependency, container, and secret scanning.
- [ ] Add audit export and customer data deletion.
- [ ] Complete an external security review.

**Exit:** Recovery succeeds in staging, operators diagnose failures without
database editing, and no critical/high security finding remains unresolved.

## M7 — Private beta

**Objective:** Validate the complete workflow on real repositories.

- [ ] Recruit 3–5 repositories with engaged owners.
- [ ] Publish the supported repository/npm matrix.
- [ ] Define support, privacy, security, and acceptable-use expectations.
- [ ] Provide disconnect and deletion controls.
- [ ] Instrument installation through owner decision.
- [ ] Track false positives, reproduction failures, rejected patches, CI failures,
  review time, and accepted repairs.
- [ ] Replay at least five historical incidents.
- [ ] Correctly reproduce at least three.
- [ ] Produce at least two maintainable repairs accepted by engineers.
- [ ] Confirm zero repairs advance with failed required evidence.

**Exit:** A repository repeatedly completes the journey without internal
engineering intervention.

## M8 — Ecosystem expansion

Recommended order: pnpm, Yarn, Python, Go, Rust, Bun, Maven/Gradle,
Ruby/Bundler, PHP/Composer, and .NET/NuGet.

Each adapter requires:

- [ ] Read-only discovery and workspace detection.
- [ ] Structured updates and advisories.
- [ ] Explicit network and lifecycle-script policy.
- [ ] Conservative version selection.
- [ ] Deterministic manifest or lockfile updates.
- [ ] Exact scope enforcement and before/after proof.
- [ ] Unit fixtures, isolated integration tests, and one end-to-end repair.
- [ ] Supported and unsupported configuration documentation.

## Cross-cutting evidence hardening

- [x] Pin the exact base commit throughout every run.
- [x] Protect oath, workflow, ownership, and Software Oath configuration files.
- [ ] Handle renames, symlinks, submodules, binary diffs, and unusual Git paths.
- [ ] Record commands, exit codes, durations, output digests, runner, and image.
- [ ] Version canonical receipt and attestation formats.
- [ ] Verify signatures at every trust transition.
- [ ] Support trusted-key rotation and revocation.
- [ ] Store final evidence with immutable semantics.

## Documentation alignment

- [ ] Label features available, experimental, planned, local-only, or hosted.
- [ ] Say “polyglot discovery, npm automation” until more adapters are complete.
- [ ] Separate demo mode from connected mode.
- [ ] Publish the support matrix and production runner requirements.
- [ ] Document the lack of same-PR CI repair until implemented.
- [ ] Add security, threat-model, operator, recovery, and onboarding guides.

## Deferred from the first production release

- Automatic approval or merge.
- Automatic production deployment.
- Automatic customer database migrations.
- Arbitrary-language repair support.
- Same-PR automatic CI repair.
- Billing and self-service paid plans.
- Organization-wide inherited oaths.
- Anonymous or marketplace execution of private source.

## Immediate execution order

1. Complete M0.
2. Complete M1 before running untrusted repositories.
3. Build and stabilize M2.
4. Build M3 onboarding.
5. Replace demo paths through M4.
6. Complete M5.
7. Finish M6.
8. Run M7.
9. Use beta evidence to prioritize M8.

Immediate milestone:

> From a fresh deployment, a GitHub owner can connect a test repository and
> receive one safely isolated, independently verified npm repair draft pull
> request without manual backend intervention.

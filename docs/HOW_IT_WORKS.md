# How Software Oath works

This guide follows one repository from its first local scan through a connected
Software Oath run, draft pull request, CI, and owner review.

The durable product direction, business-understanding requirements, knowledge
model, and customer-question policy are defined in
[PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md). Implementation decisions should
remain consistent with that contract.

## The short version

Software Oath is a repository steward that you operate. You connect a GitHub
repository, define the promises that repository must preserve, and choose a
schedule. Software Oath then:

1. Checks out an immutable repository commit.
2. Loads its previous memory of the repository.
3. Discovers workspaces, ecosystems, lockfiles, and toolchains.
4. Activates only the adapters relevant to that repository.
5. Runs the repository's committed checks and maintenance detectors.
6. Updates repository memory and prioritizes findings.
7. Produces a bounded patch when a safe automatic repair exists.
8. Verifies the patch independently.
9. Opens a draft GitHub pull request and monitors CI.
10. Waits for the repository owner.

Software Oath never approves or merges its own pull request.

## Two ways to begin

### 1. Local scan

Use this first. It verifies that Software Oath understands the repository before
you connect GitHub automation.

From the Software Oath source repository:

```powershell
npm install
npm link
```

Then open the repository you want to steward:

```powershell
cd C:\path\to\your-repository
software-oath init .
```

`init` creates a draft `software-oath.yml`. Review it carefully, then commit it:

```powershell
git add software-oath.yml
git commit -m "Configure Software Oath"
```

Run the first scan:

```powershell
software-oath scan .
```

The scan writes `.software-oath/memory.json`. That local file is ignored by Git.
It records the repository structure, capability plan, active adapters, coverage
gaps, validation commands, findings, and scan history.

The local scan does not create a branch or pull request.

### 2. Connected stewardship

Connected stewardship adds schedules, durable history, GitHub delivery, CI
monitoring, owner authentication, and signed final decisions.

Software Oath currently requires:

- An API process.
- A worker process.
- PostgreSQL.
- A GitHub App installed on each repository being stewarded.
- A GitHub OAuth App for owner sign-in.
- Persistent artifact storage.

Start the local production-shaped stack from the Software Oath repository:

```powershell
docker compose up --build
```

The complete environment and GitHub App setup is documented in
[DEPLOYMENT.md](DEPLOYMENT.md).

## The repository oath

Every connected repository must commit `software-oath.yml` to its default branch.
This file defines promises that repairs are not allowed to weaken.

Example:

```yaml
version: 1

application:
  name: Storefront
  repository: acme/storefront
  defaultBranch: main

approval:
  requireHumanFor: []
  allowAutomaticMerge: false

cost:
  enabled: true
  requireEstimate: true
  currency: USD
  maxMonthlyIncrease: 50
  maxPercentageIncrease: 10

rules:
  - id: repository.quality
    title: Repository quality checks remain green
    description: Lint, tests, and build must pass.
    severity: high
    evidence:
      - kind: command
        command: npm run lint
        required: true
      - kind: command
        command: npm run test:run
        required: true
      - kind: command
        command: npm run build
        required: true
```

Software Oath rejects automatic merge configuration. A repair cannot change the
oath or weaken its evidence requirements.

When cost policy is enabled and supported IaC is present, a missing estimate blocks
the repair by default. Any increase requires owner review; increases above either
configured limit are blocked.
## Connect GitHub

Create and configure the Software Oath GitHub App, then install it on the target
repository. The App needs:

- Contents: write, to create a repair branch and commit.
- Pull requests: write, to open a draft PR.
- Metadata: read.
- Checks: read, to monitor CI.

The App does not merge pull requests. Owner sign-in and repair decisions use a
separate GitHub OAuth session and a live repository write-permission check.

## Register the repository

Register the target repository with the Software Oath API:

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

Schedule modes are:

- `disabled`: owner-triggered scans only.
- `daily`: once per day.
- `weekly`: once per week.
- `custom`: a five-field cron schedule.

The hosted onboarding screen that will replace this manual API call has not been
built yet.

## Start a scan

A scan starts when its schedule becomes due or when an authenticated owner calls:

```text
POST /api/repositories/:owner/:repo/scan
```

External incident adapters such as Sentry are optional. They are not required for
normal repository stewardship.

## What happens inside a scan

### 1. Checkout

The worker obtains a short-lived GitHub installation token, creates a disposable
workspace, clones the repository, and checks out the selected commit.

### 2. Memory

Software Oath loads the previous repository memory and compares it with the
current commit. Every scan writes an updated memory record, including clean scans.

Connected scans also synchronize typed knowledge into the control plane. The
first scan records observed repository and workspace facts and opens focused
owner questions about business purpose, critical journeys and rules, and
operations that must always require human review.

### 3. Read-only discovery

Software Oath examines tracked filenames before running a dependency command. It
groups manifests, lockfiles, and toolchain declarations into workspaces and
builds a capability plan.

Discovery:

- Does not install application dependencies.
- Does not execute repository code.
- Does not run lifecycle scripts.
- Does not activate an adapter merely because it is installed on the worker.

For example:

```text
package.json + package-lock.json → npm adapter
package.json + pnpm-lock.yaml    → pnpm coverage
pyproject.toml + uv.lock         → Python/uv coverage
Cargo.toml + Cargo.lock          → Rust/Cargo coverage
go.mod + go.sum                  → Go module coverage
```

Only npm is an active dependency adapter today. Recognized unsupported
workspaces appear as owner-visible coverage gaps and are retained in memory.

### 4. Analysis

The active npm adapter uses structured `npm outdated` and `npm audit` results.
It does not run lifecycle scripts during analysis. If an advisory check cannot
complete, Software Oath records a security coverage failure instead of claiming
that the repository is clean.

Software Oath also runs deterministic repository detectors and the commands
committed in `software-oath.yml`.

### 5. Decision

A finding can have one of three outcomes:

- No repair is needed: complete the run without a PR.
- Review is required: record an owner suggestion without an automatic patch.
- Automatic candidate: attempt one bounded repair within its declared paths.

Major package updates remain review-only unless the repository policy explicitly
allows them.

## How a repair works

Software Oath creates a detached temporary Git worktree and selects the relevant
repair adapter. npm dependency repairs use lockfile-only mode with lifecycle
scripts disabled.

After the change, Software Oath independently verifies:

- At least one file changed.
- Every changed file is inside the finding's allowlist.
- `software-oath.yml` was not weakened.
- Required repository checks passed.
- The original finding disappeared.
- No new critical or high-severity finding appeared.

The patch, verification evidence, and before/after proof are signed with an
Ed25519 repair receipt. The temporary worktree is then removed.

## Draft pull request and CI

When local verification accepts the repair, Software Oath:

1. Creates a `software-oath/...` branch.
2. Applies the verified patch.
3. Pushes one repair commit.
4. Opens a draft pull request.
5. Links the signed receipt.
6. Monitors GitHub checks.

When CI passes, the run becomes available for owner review. When CI fails, the
PR remains unmergeable and the failure is recorded.

Bounded same-PR CI failure repair is not implemented yet. Today Software Oath
monitors and reports the failure but does not automatically add a corrective
commit.

## Owner review

The owner signs in with GitHub. Immediately before accepting a decision,
Software Oath verifies that the user still has `admin`, `maintain`, or `push`
permission on the affected repository.

The owner can:

- Inspect findings and evidence.
- Review the changed files and draft PR.
- Inspect CI.
- Approve or reject the Software Oath decision with a reason.
- Edit, close, or merge the pull request through GitHub.

The decision creates a second signed attestation binding the repository, commits,
PR, repair receipt, verification result, reviewer, reason, and timestamp.

Software Oath has no merge operation. Merging remains the repository owner's
decision.

Authorized owners can inspect durable knowledge and questions through:

```text
GET /api/repositories/:owner/:repo/knowledge
GET /api/repositories/:owner/:repo/questions
POST /api/repositories/:owner/:repo/questions/:questionId/answer
```

Answering requires an authenticated GitHub session, CSRF validation, and a live
repository write-permission check. An answer is stored once and atomically
creates owner-confirmed knowledge with reviewer identity, authorization, time,
and question provenance. The graphical question-and-memory interface remains to
be built.

## Normal ongoing operation

After setup, the recurring workflow is:

```text
schedule or owner trigger
→ checkout
→ memory and capability plan
→ analysis
→ bounded repair when safe
→ verification
→ draft PR
→ CI
→ owner review
→ owner merges or rejects
```

Clean scans update memory but do not create PRs. Review-only findings become
suggestions. Verified automatic findings become draft PRs.

## What works today and what remains

Implemented:

- Local and connected scans.
- Daily, weekly, custom, disabled, and owner-triggered schedules.
- Persistent repository memory.
- Dynamic adapter and workspace discovery.
- Active npm update and advisory detection.
- Conservative npm repair.
- Bounded verification and signed receipts.
- Draft PR delivery and CI monitoring.
- GitHub owner authentication and permission checks.
- Never-merge enforcement.
- Typed repository knowledge and owner-question APIs.

Still to build:

- Hosted graphical repository onboarding and question interface.
- Active pnpm, Yarn, Bun, Python, Rust, Go, and other ecosystem adapters.
- Bounded same-PR CI repair.
- Deeper architecture, ownership, and change-impact memory.
- Production-grade worker and network isolation.
- Production object storage, retention, scaling, and recovery.

## Related documentation

- [Product contract and durable direction](PRODUCT_CONTRACT.md)
- [Deployment and secrets](DEPLOYMENT.md)
- [Architecture and trust boundaries](ARCHITECTURE.md)
- [Connected MVP status](MVP.md)

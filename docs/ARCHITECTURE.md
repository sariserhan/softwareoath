# Architecture

## Design principles

1. **Evidence outranks agent claims.** A model saying “fixed” is not evidence.
2. **The constitution is protected input.** A repair agent cannot weaken it.
3. **Fail closed.** Missing required evidence blocks or requires review.
4. **Separate proposal from acceptance.** The agent that writes a patch cannot approve it.
5. **Preserve originals.** Every run is tied to immutable commits and input digests.
6. **Increase autonomy by risk class.** Low-risk repairs may earn automation later.

## Target system

```text
GitHub App ─────────────┐
Sentry webhook ─────────┼──> Control plane
Deployment telemetry ───┘         │
                                  ├── Constitution service
                                  ├── Incident and run state
                                  ├── Policy/approval engine
                                  └── Receipt store
                                           │
                                    Job dispatcher
                                           │
                                  Isolated runner
                                  ├── Checkout
                                  ├── Reproduce
                                  ├── Repair
                                  ├── Test
                                  └── Package evidence
                                           │
                                    GitHub pull request
```

## Components

### Control plane

Owns organizations, installations, repositories, incidents, repair runs, leases,
status transitions, approvals, and audit events. It never executes repository code
inside the API process.

### Constitution service

Loads the oath from the immutable base commit, validates the schema, resolves evidence
requirements, and computes a decision from runner evidence. Future versions may support
organization-wide inherited rules, but version 1 is repository-local.

### Isolated runner

Runs each repository in an ephemeral sandbox with:

- A writable copy of the checked-out source.
- CPU, memory, process, disk, and time limits.
- No host credentials.
- Network denied by default and allowlisted per job when required.
- Short-lived GitHub installation credentials scoped to the repository.
- Separate output storage for patches, logs, test reports, and receipts.

The runner must never execute customer code on a marketplace provider.

The current runner interface provides direct execution for explicitly trusted local
repositories and a disposable Docker implementation with networking disabled by
default, dropped capabilities, `no-new-privileges`, and CPU/memory limits. Hosted
execution should replace Docker with short-lived microVMs behind the same interface.

### Dependency stewardship

Repository discovery first builds a capability plan from tracked filenames. It
groups manifests, lockfiles, and toolchain declarations into workspaces and does
not execute adapters, install dependencies, or run repository code. Adapter
activation is dynamic: npm is selected only for npm-compatible workspaces, while
pnpm, Yarn, and Bun are distinguished by lockfile. Recognized but unsupported
ecosystems produce owner-visible coverage gaps and remain in repository memory.

Each adapter declares its activation files, capabilities, support status, and
execution policy, including whether registry network access is needed and whether
it installs application dependencies or runs lifecycle scripts. Only active
adapters matching the capability plan may analyze a workspace.

The active npm adapter consumes structured output from `npm outdated` and `npm
audit`. A failed advisory query becomes a security finding, so registry or tool
failure cannot be misreported as a clean scan.

Eligible npm findings carry the package, installed version, conservative target,
update kind, manifest, lockfile, and advisory identifiers. The built-in updater
uses `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
Normal path boundaries, oath verification, signed receipts, draft-PR delivery,
and CI gates still apply. Software Oath never merges the pull request.

### Repair agent

Receives a bounded task: incident context, failing reproduction, allowed repository
scope, and immutable oath rules. It may change application files and add tests. It may
not change the base oath, evidence policy, approval records, or the runner.

The local product implements this boundary with a detached Git worktree and the
authenticated Codex CLI. The original checkout is never modified. After the agent
returns, Software Oath rejects changes outside the finding's allowlist, executes
the repository-defined oath commands, and independently inspects the modified tree.
Acceptance requires both the original finding to disappear and the absence of new
critical or high-severity findings. Software Oath then exports a patch and receipt
containing that before-and-after proof and removes the temporary worktree. The agent
is replaceable; acceptance remains deterministic.

In GitHub Actions, generation and publication use separate trust domains. The
read-only job checks out source without persisted Git credentials, runs repository
checks before the OpenAI credential is introduced, delegates repair to the official
Codex Action, verifies scope and oath evidence, and exports an artifact. A second
job receives the patch and receipt but never the OpenAI key; only that job receives
GitHub content and pull-request write permissions.

### Infrastructure cost evidence

When a repository oath enables cost policy, Software Oath detects Terraform,
Terragrunt, CloudFormation, and supported CDK-generated inputs before invoking the
isolated Infracost adapter. Baseline and proposed estimates execute concurrently in
separate ephemeral containers through a fixed broker route. The policy evaluator
normalizes currency, monthly totals, projects, resources, and unsupported resources.

A missing required estimate or an increase above either owner threshold blocks the
repair. A positive increase within limits requires owner review. Unchanged or lower
cost passes. Raw estimate digests are part of the signed repair receipt, so the
existing receipt and final-attestation trust chain covers cost evidence without
creating a parallel approval channel.

### Evidence evaluator

This repository's current deterministic evaluator is the beginning of this component.
It maps evidence records to required rules and produces:

- `blocked`: required evidence failed.
- `review_required`: evidence or policy requires human judgment.
- `ready`: all required evidence passed and policy permits proceeding.

### Receipt store

A receipt should include input and result digests, commits, changed paths, commands,
exit codes, test reports, agent/model versions, rule evaluations, the selected
finding's resolution, before-and-after finding counts, newly introduced findings,
approval identities, timestamps, and the resulting pull request.

The connected control plane uses a two-link evidence chain. The repair receipt is
signed immediately after deterministic verification. A final attestation is
signed when the human decision is recorded and includes the repair receipt digest
and signature together with delivery metadata and the reviewer decision. The
approval row and final attestation are committed atomically.

Human authority is separate from operator authority. Shared operator credentials
can manage mappings and cancellation but cannot decide a repair. Reviewer
identity is derived from GitHub OAuth, access tokens remain encrypted in
server-side sessions, and repository authorization is checked against GitHub at
decision time. CSRF validation precedes every decision.

Repository stewardship is the primary trigger. Each registered repository owns
its schedule and repair limits. The worker calculates due runs internally,
checks out the default branch, and refreshes a deterministic memory file before
selecting work. That memory is keyed by commit and retains structural inventory,
validation capabilities, current findings, and bounded scan history. External
incident systems are optional adapters rather than control-plane dependencies.

After opening a draft pull request, the run remains `ci_pending`. Software Oath
queries GitHub checks directly and exposes the repair for owner review only after
CI succeeds. Failed CI leaves the PR unmerged and records the failing checks.

The file-backed store remains available for local development. The production path
uses PostgreSQL. Workers claim runs through `FOR UPDATE SKIP LOCKED`, attach an
expiring lease, and persist attempts, exponential backoff, cancellation, errors,
and lifecycle logs.

### Integration adapters

Sentry requests are authenticated over the untouched raw body using HMAC-SHA256
and deduplicated by issue ID. GitHub operations exchange a short-lived App JWT for
an installation token, dispatch the split-permission workflow, and create a draft
pull request only from an already verified repair branch.

The orchestrator connects these boundaries without allowing one to silently
approve another:

```text
signed incident → durable run → leased checkout → bounded repair
→ independent proof gate → durable artifact → draft PR → human decision
```

## Data model

Core entities:

- Organization
- User
- GitHubInstallation
- Repository
- ConstitutionVersion
- Incident
- RepairRun
- Job
- EvidenceRecord
- RuleEvaluation
- Approval
- Receipt

## Trust boundaries

The highest-risk boundary is between the control plane and customer code. Repository
content, tests, package scripts, generated patches, logs, and artifacts are untrusted.
Secrets must be brokered per operation rather than injected wholesale into a runner.

The second boundary is between repair generation and acceptance. An AI-authored test
cannot independently prove its own repair; existing tests, invariant checks, independent
evaluation, code owners, canaries, and production monitoring provide separate evidence.

## Reusing PlanetNodes

PlanetNodes remains an independent product. Later, Software Oath may reuse or extract:

- Leased job execution.
- Cancellation and retry semantics.
- Sandboxed build execution.
- Log streaming.
- Artifact storage.
- Workload and result receipts.

The first connected MVP should use a dedicated trusted runner so Software Oath does not
depend on marketplace scheduling, provider payouts, or public compute supply.
## Dependency Optimizer O1 boundary

The optimizer's first shared analysis path is experimental and disabled by default.
When SOFTWARE_OATH_OPTIMIZER_ANALYSIS_ENABLED=true, registered stewardship scans
perform a bounded static read of Git-tracked text files in the disposable checkout.
The reader does not install dependencies or execute repository code. It rejects unsafe
paths, skips symlinks and binary/oversized files, and caps file count and total bytes.

O1 persists normalized signal records rather than source files or environment values.
Records are bound to the registered repository ID, a GitHub-installation-derived tenant
key, and the immutable commit. Live GitHub authorization protects list and detail APIs:

- GET /api/repositories/{repository}/optimizer/analyses
- GET /api/repositories/{repository}/optimizer/analyses/{analysisId}

The disposable checkout is removed by the existing orchestrator cleanup. Private
repository rollout remains blocked on the unfinished O1 isolation and M6 retention,
deletion, recovery, and operational controls documented in the optimizer roadmap.

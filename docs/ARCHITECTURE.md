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

### Repair agent

Receives a bounded task: incident context, failing reproduction, allowed repository
scope, and immutable oath rules. It may change application files and add tests. It may
not change the base oath, evidence policy, approval records, or the runner.

The local product implements this boundary with a detached Git worktree and the
authenticated Codex CLI. The original checkout is never modified. After the agent
returns, Software Oath rejects changes outside the finding's allowlist, executes
the repository-defined oath commands, exports a patch and receipt, and removes the
temporary worktree. The agent is replaceable; acceptance remains deterministic.

In GitHub Actions, generation and publication use separate trust domains. The
read-only job checks out source without persisted Git credentials, runs repository
checks before the OpenAI credential is introduced, delegates repair to the official
Codex Action, verifies scope and oath evidence, and exports an artifact. A second
job receives the patch and receipt but never the OpenAI key; only that job receives
GitHub content and pull-request write permissions.

### Evidence evaluator

This repository's current deterministic evaluator is the beginning of this component.
It maps evidence records to required rules and produces:

- `blocked`: required evidence failed.
- `review_required`: evidence or policy requires human judgment.
- `ready`: all required evidence passed and policy permits proceeding.

### Receipt store

A receipt should include input and result digests, commits, changed paths, commands,
exit codes, test reports, agent/model versions, rule evaluations, approval identities,
timestamps, and the resulting pull request.

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

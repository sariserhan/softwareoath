# Software Oath product contract

This document is the durable product alignment for Software Oath. Architecture,
features, and implementation decisions should be checked against it. If product
direction changes, update this document deliberately rather than allowing the
implementation to drift.

## North star

Software Oath is a self-operated repository steward that learns an entire
codebase and its business purpose, remembers what it learns, continuously finds
maintenance and security problems, prepares bounded verified repairs, opens
draft pull requests, and waits for the repository owner.

Software Oath is not merely:

- A dependency updater.
- A vulnerability dashboard.
- An error-monitoring integration.
- A generic coding agent.
- An autonomous merge bot.

The product succeeds when a repository owner can connect an unfamiliar
repository and Software Oath can develop a reliable, evidence-backed
understanding of both the software and the business behavior it must preserve.

## Non-negotiable behavior

Software Oath must:

1. Understand before changing.
2. Separate observed facts, inferences, and owner-confirmed rules.
3. Ask the owner when consequential knowledge cannot be established safely.
4. Make the smallest bounded change that resolves a finding.
5. Verify repairs independently using repository-owned evidence.
6. Update repository memory after every scan, including clean scans.
7. Explain findings, uncertainty, changes, and verification.
8. Open draft pull requests rather than merging.
9. Require the repository owner to decide whether a pull request is merged.
10. Fail closed when security coverage or required evidence is unavailable.
11. Run customer code only inside an appropriate isolated worker.
12. Activate ecosystem tooling dynamically from repository evidence.

Software Oath must never:

- Approve or merge its own pull request.
- Weaken `software-oath.yml` to make a repair pass.
- Treat an inference as an owner-confirmed business rule.
- Claim a security scan is clean when the scan did not complete.
- Install every supported ecosystem or customer dependency globally.
- Execute untrusted customer code in the API or control-plane process.
- Make an unrelated change merely because it found an opportunity.

## The complete customer journey

```text
customer connects repository
→ read-only repository discovery
→ capability and workspace plan
→ initial technical and business model
→ focused owner questions where needed
→ persistent repository memory
→ maintenance and security analysis
→ prioritized findings and suggestions
→ bounded repair when authorized
→ independent verification
→ signed evidence
→ draft pull request
→ CI monitoring and bounded follow-up
→ owner review
→ owner merges, edits, or rejects
→ outcome becomes new repository knowledge
```

## First repository scan

The first scan establishes a baseline. Before installing dependencies or running
repository code, Software Oath reads tracked repository material and discovers:

- Languages, frameworks, and runtime platforms.
- Applications, services, libraries, packages, and monorepo workspaces.
- Entry points, background workers, jobs, and scheduled tasks.
- Dependency manifests and lockfiles.
- Toolchain declarations and version constraints.
- Build, test, lint, formatting, and type-check commands.
- CI and deployment workflows.
- Databases, schemas, migrations, and data flows.
- APIs, events, queues, and external integrations.
- Authentication, authorization, and trust boundaries.
- Architecture documentation and decision records.
- Code ownership and protected or high-risk areas.
- Generated files and vendored code.
- Existing findings, missing checks, and unavailable coverage.

Discovery is read-only. It does not install application dependencies, run
lifecycle scripts, or execute customer code.

After discovery, Software Oath creates a repository-specific capability plan and
activates only relevant supported adapters. Any recognized but unsupported
workspace becomes an owner-visible coverage gap.

## Technical understanding

Software Oath must build a living technical model, not merely a file inventory.
The model should describe:

- Components and their responsibilities.
- Dependencies between components.
- Runtime and deployment topology.
- Requests, events, and data moving through the system.
- Public and private interfaces.
- Persistence boundaries and data ownership.
- Authentication and permission checks.
- Critical execution paths.
- Validation and release processes.
- Areas where a change has elevated operational or security risk.

The model is updated incrementally when the repository changes. Software Oath
should not rediscover the unchanged codebase blindly on every scan.

## Business understanding

Technical behavior does not fully describe business intent. Software Oath must
also learn:

- What the product does and who uses it.
- Critical user journeys.
- Business invariants.
- Roles and permissions.
- Financial rules and approval thresholds.
- Regulatory and compliance requirements.
- Data classification, privacy, and retention expectations.
- Availability and recovery expectations.
- Operations that always require a human.
- Behaviors that must never change automatically.
- Accepted and unacceptable risks.

Example:

```text
Observed technical fact:
Orders are stored in PostgreSQL.

Owner-confirmed business rule:
A paid order must never return to an unpaid state.
```

The business rule cannot be considered confirmed merely because the current code
appears to implement it.

## Sources of knowledge

Software Oath learns from four classes of sources.

### Repository evidence

Code, tests, documentation, schemas, configuration, workflows, history, and
committed policy.

### Observed operational evidence

CI results, earlier failures, previous scans, repair outcomes, owner decisions,
and recurring findings.

### Explicit owner knowledge

Onboarding answers, confirmed business rules, protected workflows, risk policy,
accepted risks, and explanations from authorized repository owners.

### Inference

Architecture, purpose, or behavior inferred from repository evidence. Inference
must carry confidence and provenance. It must never silently become confirmed
business truth.

## Repository memory

Hosted repository memory belongs in Software Oath's protected artifact storage.
It is not committed to the customer repository. A local scan may use an ignored
`.software-oath/memory.json`.

Memory must distinguish these knowledge types:

- Observed technical fact.
- Inferred technical fact.
- Owner-confirmed business fact.
- Owner-confirmed business rule.
- Repository-enforced oath rule.
- Temporary assumption.
- Accepted risk.
- Unanswered question.
- Historical observation.

Each durable knowledge item should include:

- Stable identifier.
- Knowledge type.
- Statement.
- Repository and component scope.
- Source and evidence references.
- Confidence.
- First observed time and commit.
- Last verified time and commit.
- Owner confirmation identity and time, when applicable.
- Expiration or review date, when applicable.
- Related files, symbols, services, workflows, and findings.
- Whether it may block a repair.

Repository memory should retain:

- Repository and workspace profile.
- Architecture and dependency graph.
- Toolchains and known commands.
- Business scope and critical journeys.
- Confirmed rules and protected areas.
- Current and historical findings.
- Previous patches, PRs, and CI outcomes.
- Owner decisions and preferences.
- Known flaky checks and recurring failures.
- Dependency and vulnerability history.
- Coverage gaps and unavailable capabilities.

Every scan updates memory, even when no finding or repair exists.

## Customer questions

Software Oath must ask focused questions when an answer would materially affect
correctness, security, business behavior, or repair authority.

Example questions:

- Can an order be cancelled after shipment?
- Is this endpoint intended to be public?
- Which service is authoritative for the customer record?
- Does this payment operation require an immutable audit record?
- Is this failing test obsolete or required behavior?
- May this dependency receive a major-version update?

Every question should contain:

- The question in plain language.
- Why Software Oath is asking.
- Repository evidence that created the ambiguity.
- The code, component, rule, or finding affected.
- The decision that depends on the answer.
- Suggested answers when evidence supports them.
- The identity or role authorized to answer.
- Whether the question blocks work.
- An expiration or revalidation condition where appropriate.

Answers become owner-confirmed memory with identity, time, scope, and reason.
Critical confirmed business rules may be proposed as changes to
`software-oath.yml`, but Software Oath must never add or modify those promises
without owner review.

### Blocking policy

- Noncritical questions do not block an entire repository scan.
- A question blocks only the affected finding or repair by default.
- Unanswered critical business questions prevent related pull requests.
- Unrelated low-risk technical maintenance may continue.
- Owner-confirmed rules outrank inference.
- Repository-enforced oath rules remain protected input.

## Analysis responsibilities

Software Oath should eventually analyze:

- Vulnerable dependencies.
- Outdated packages and toolchains.
- Broken tests and builds.
- Lint, formatting, and type errors.
- CI failures.
- Exposed secrets and unsafe credentials.
- Unsafe configuration and permissions.
- Deprecated APIs.
- Dead or unused code.
- Unsupported runtimes.
- Dependency provenance and license risk.
- Documentation drift.
- Architecture and dependency-boundary violations.
- Repository-specific business-rule regressions.

An unavailable analysis capability must be visible as missing coverage, not
silently treated as a clean result.

## Repair policy

Software Oath may repair a finding only when:

- The problem and intended outcome are sufficiently understood.
- Required business knowledge is confirmed or the change is unrelated to it.
- The finding explicitly permits an automatic candidate.
- Allowed files and commands are bounded.
- The repository policy permits the risk class.
- Required verification evidence is available.

For every repair, Software Oath must:

1. Select the relevant adapter or bounded repair agent.
2. Create a disposable repair workspace.
3. Restrict changes to allowed paths.
4. Protect the oath, tests, and verification policy from weakening.
5. Make the smallest reasonable change.
6. Run repository-defined checks.
7. Rescan the changed repository.
8. Confirm the selected finding disappeared.
9. Reject new critical or high-severity findings.
10. Produce signed evidence.
11. Open a draft pull request.
12. Wait for the owner.

Deterministic repair strategies are preferred. A general coding agent is used
only when a deterministic adapter cannot safely produce the bounded change.

## Pull requests and CI

Software Oath may create branches, commits, and draft pull requests. It monitors
CI and should eventually make a bounded number of corrective commits on the same
draft PR.

It must prevent:

- Duplicate PR loops.
- Unlimited repair attempts.
- Unrelated repair grouping.
- Automatic approval.
- Automatic merge.
- Branch-protection bypass.

The repository owner may edit, reject, close, or merge the PR. That outcome is
recorded as repository knowledge.

## Self-reliance boundary

Software Oath owns its orchestration, memory, policy, analysis normalization,
repair decisions, evidence, and approval system. It does not require Sentry or a
similar monitoring SaaS.

Some authoritative upstream data is inherently external:

- Git hosting and CI state.
- Package registries.
- Language and ecosystem advisory feeds.
- Customer repositories.

Software Oath may consume those sources through controlled adapters, but it must
not delegate its understanding, decision policy, memory, or owner authority to
them. External-source failure is explicit and fail-closed.

## Product priorities

Work should proceed in this order:

1. Repository knowledge graph and owner-question workflow.
2. Deeper technical and business-scope discovery.
3. npm-family completion and same-PR CI repair.
4. Python, Rust, and Go adapters.
5. Lint, type, test, configuration, and security repair engines.
6. Production worker isolation and network enforcement.
7. Owner onboarding, memory, policy, and question interfaces.
8. Real-repository pilots and reliability hardening.
9. Remaining ecosystem adapters.
10. Production scaling, retention, backup, and recovery.

Adding another detector should not take priority over preserving this product
model.

## Current implementation boundary

Implemented today:

- Local and connected repository scans.
- Persistent commit-keyed repository memory.
- Dynamic workspace and adapter discovery.
- Owner-visible capability gaps.
- Active npm update and advisory detection.
- Conservative npm repair.
- Repository-defined verification.
- Signed repair receipts and final attestations.
- Draft PR creation and CI monitoring.
- GitHub owner authentication and permission checks.
- Never-merge enforcement.
- Typed observed repository knowledge synchronized after connected scans.
- Focused first-scan owner questions and authenticated answer APIs.
- Atomic conversion of answers into owner-confirmed business knowledge.

Still incomplete:

- A rich symbol, component, data-flow, and business relationship graph.
- The owner-question and memory user interface.
- Enforcement that maps an unanswered question to the exact affected repair.
- Thorough business-scope onboarding.
- Deep architecture and change-impact modeling.
- Active non-npm ecosystem adapters.
- Same-PR CI correction.
- Full production worker and network isolation.
- Production-grade owner onboarding, storage, scaling, and recovery.

## Decision rule for future work

Before building a feature, ask:

1. Does this help Software Oath understand the repository or business better?
2. Does it preserve owner authority?
3. Is uncertainty represented honestly?
4. Is execution bounded and independently verified?
5. Does memory improve after the work?
6. Does it reduce reliance on unowned decision systems?
7. Can it operate safely on an unfamiliar repository?

If the answer is no, the feature should be reconsidered.

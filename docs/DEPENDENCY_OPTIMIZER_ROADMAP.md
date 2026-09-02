# Dependency Optimizer integration roadmap

## Product decision

Build the AI SaaS Dependency Optimizer as a distinct product surface on top of
Software Oath's trusted repository platform. The optimizer discovers and evaluates
opportunities; Software Oath remains the authority for bounded changes, independent
verification, signed evidence, draft pull requests, and owner decisions.

    read-only repository evidence
            ↓
    Dependency Optimizer
    detect → infer capabilities → price → recommend
            ↓
    owner-confirmed migration specification
            ↓
    Software Oath
    authorize → migrate in isolation → verify → attest → draft PR
            ↓
    repository owner decides

The first release proves one trustworthy TypeScript email workflow. It does not
attempt to become a general SaaS marketplace or broad cloud FinOps product.

## Relationship to the existing roadmap

Software Oath M0–M5 already provide most of the trust foundation:

- M1: isolated execution and credential brokering.
- M2: verified repair-to-draft-PR delivery.
- M3: GitHub App onboarding and read-only repository access.
- M4: connected APIs, durable jobs, evidence, history, and UI states.
- M5: owner review, signed receipts, and final attestations.
- Infracost: deterministic IaC cost-policy evidence. It complements, but does not
  replace, the optimizer's SaaS pricing engine.

Production customer-code analysis must not launch before the relevant M6 security,
retention, recovery, rate-limiting, observability, and deletion controls are ready.
Catalog development, fixtures, and deterministic engines can proceed in parallel
with M6 because they do not require private customer repositories.

## Adjacent public reference projects

These repositories are useful adjacent examples for the product direction and UI
language around bounded, observable, evidence-driven tooling. They are not part of
Software Oath's core dependency-optimizer scope, but they help frame the broader
patterns the optimizer targets when it turns repository evidence into trusted,
reviewable recommendations.

- [localwall](https://github.com/sariserhan/localwall)
- [visitorping](https://github.com/sariserhan/visitorping)
- [aurowall](https://github.com/sariserhan/aurowall)
- [alwaysdraw](https://github.com/sariserhan/alwaysdraw)

## First vertical slice

### Supported

- TypeScript and JavaScript repositories.
- Resend as the current provider.
- Amazon SES and Postmark as alternatives.
- Direct SDK calls and documented common wrapper patterns.
- Transactional email capabilities.
- Deterministic, versioned USD pricing.
- User-supplied monthly volume and current plan or bill.
- Evidence-backed KEEP, INVESTIGATE, REPLACE, or INSUFFICIENT_DATA.
- A signed, agent-ready migration specification.

### Deferred

- Other service categories and programming languages.
- Provider billing connections and automatic pricing publication.
- Automatic repository modification from an analysis.
- Automatic PRs without separate owner authorization.
- Automatic approval, merge, deployment, DNS changes, data migration, or cutover.
- A single opaque compatibility percentage.
- Savings-based billing.

## Ownership boundaries

### Shared platform

Reuse GitHub identity and installation, tenancy, immutable commit pinning, isolated
runners, jobs and leases, repository memory, typed APIs, artifacts, audit events,
signing, retention/deletion controls, and connected UI states.

### Optimizer

Own the service catalog, capability taxonomy, observed API patterns, compatibility
graph, versioned SaaS pricing, usage-input schemas, migration-risk model,
deterministic recommendation engine, and migration-specification generator.

### Software Oath

Own change authorization, agent execution, allowed-path enforcement, independent
verification, Infracost policy enforcement for IaC, receipts, attestations, draft
PR delivery, CI monitoring, and human decisions.

## Non-negotiable trust rules

1. Analysis remains read-only until a separate migration authorization.
2. Observed facts, inferences, owner confirmations, assumptions, and estimates stay
   distinct in storage and UI.
3. AI may interpret code and draft explanations. Deterministic code owns catalogs,
   compatibility gates, pricing, thresholds, schemas, and final recommendations.
4. Missing required evidence returns INSUFFICIENT_DATA or INCOMPATIBLE, never REPLACE.
5. Required capabilities are gates; no aggregate percentage can override a failed gate.
6. Process source ephemerally and retain only normalized evidence and minimal snippets
   under an explicit retention policy.
7. Analyze environment-variable names only, never values or secrets.
8. A recommendation cannot modify a repository or create a PR by itself.
9. Software Oath never approves or merges its own migration.

## Compatibility and recommendation model

Compatibility is structured:

- COMPATIBLE
- COMPATIBLE_WITH_CHANGES
- UNVERIFIED
- INCOMPATIBLE

Each assessment contains required gates, optional coverage, semantic and operational
differences, unknowns, evidence, and catalog provenance. Confidence is reported
separately for service detection, capability inference, usage completeness, pricing,
and migration effort.

The deterministic recommendation engine returns:

- KEEP: risk-adjusted value does not justify change.
- INVESTIGATE: value may exist, but a consequential fact is unconfirmed.
- REPLACE: required gates pass and value clears owner policy.
- INSUFFICIENT_DATA: a defensible comparison cannot be calculated.

Savings, migration cost, operational cost, risk allowance, and payback are ranges.
Every amount includes source, currency, pricing version, effective and verified dates,
user inputs, assumptions, excluded costs, and staleness.

## Milestones

| Milestone | Outcome | Depends on |
| --- | --- | --- |
| O0 | Contracts and evaluation corpus | Software Oath M5 |
| O1 | Shared read-only analysis foundation | O0; relevant M6 controls |
| O2 | Trustworthy Resend detection | O1 |
| O3 | Email capability and compatibility graph | O2 |
| O4 | Versioned pricing and usage collection | O3 |
| O5 | Deterministic recommendations | O4 |
| O6 | Connected evidence-first UI | O5 |
| O7 | Signed migration-spec handoff | O6; Software Oath M6 |
| O8 | Private design-partner beta | O7 |
| O9 | Verified migration execution | O8 |
| O10 | Category expansion and continuous optimization | O9 |

## O0 — Contracts and evaluation corpus

**Objective:** Define truth before broad providers or UI.

- [x] Version schemas for observations, capability evidence, usage, compatibility,
  pricing, recommendations, and migration specifications.
- [x] Define provenance and required-versus-optional capability semantics.
- [x] Define recommendation policy and explicit failure states.
- [x] Define source retention, model-data, deletion, and audit policy.
- [x] Start as shared packages in this repository; extract services only when needed.
- [x] Build Resend fixtures for basic send, attachments, templates, batch, scheduling,
  tags, webhooks, inbound, wrappers, dead dependencies, comments, and examples.
- [x] Create a manually reviewed gold dataset and accuracy harness.

**Exit:** Versioned contracts and a reproducible gold corpus exist.

## O1 — Shared read-only analysis foundation

- [x] Add optimizer analyses/jobs tied to tenant, repository, and immutable commit.
- [x] Reuse GitHub App permissions; request no new write permission.
- [x] Extend repository memory with external-service observations and provenance.
- [x] Add an isolated analyzer that does not install or execute repository code.
- [x] Detect manifests, imports, initialization, runtime calls, variable names,
  endpoints, infrastructure declarations, and wrapper call chains.
- [x] Ignore comments, docs-only mentions, examples, generated/vendor code, and unused
  dependencies unless corroborated.
- [x] Persist normalized evidence, discard the checkout, and enforce M6 controls.

The analyzer runs in the trusted runner image with networking disabled and the checkout
mounted read-only. Vercel sandboxes also remove write permissions and discard sandbox
state instead of exporting it. Only schema-validated, gzip-bounded normalized evidence
crosses back to the control plane; source files and environment values do not.

**Exit:** A connected repository completes read-only analysis with minimal retained data.

## O2 — Trustworthy Resend detection

- [x] Implement an explicit evidence hierarchy and separate confidence.
- [x] Trace supported local wrappers to runtime call sites.
- [x] Let owners confirm, reject, or correct observations.
- [x] Test README, comment, example, test, mock, dead-code, and unused-package cases.
- [x] Measure precision and recall on fixtures and reviewed public repositories.

**Exit:** At least 95% precision on the gold corpus; recall and unsupported patterns
are published rather than guessed.

## O3 — Email capability and compatibility graph

- [x] Model send, HTML/text, attachments, templates, batch, scheduling, tags,
  idempotency, webhooks, inbound, contacts/audiences, and domains.
- [x] Attach evidence, reason, and confidence to every inferred capability.
- [x] Model Resend, SES, and Postmark support as exact, changed, unsupported, or unknown.
- [x] Include deliverability ownership, reputation, quotas, regions, compliance,
  webhook semantics, support, and operational burden.
- [x] Version and review catalog changes; enforce required capability gates.

**Exit:** Different usage patterns produce different compatible alternatives without
failed gates being hidden by a score.

## O4 — Versioned pricing and usage collection

- [x] Define typed pricing rules for Resend, SES, and Postmark.
- [x] Store sources, currency, region, effective date, verified date, and version.
- [x] Implement tiers, minimums, included usage, overages, and relevant add-ons.
- [x] Ask only for unresolved volume, current bill/plan, region, dedicated-IP needs,
  and critical operational requirements.
- [x] Support owner overrides without mutating canonical pricing.
- [x] Return ranges, assumptions, exclusions, completeness, and staleness.
- [x] Require review before discovered pricing changes become active.

**Exit:** Every amount is reproducible and explains its inputs, source, age, and limits.

## O5 — Deterministic recommendations

- [x] Evaluate compatibility gates before economics.
- [x] Estimate migration effort from affected files, API differences, configuration,
  DNS, infrastructure, data movement, testing, rollout, and rollback.
- [x] Model operational complexity independently from code effort.
- [x] Calculate risk-adjusted value and payback ranges using owner-configured labor cost.
- [x] Version policy and input digests.
- [x] Test cheaper alternatives that must still return KEEP.
- [x] Test stale pricing, missing data, unsupported capabilities, low savings, high
  operational burden, and contradictory evidence.

**Exit:** Every decision is reproducible and cannot be changed by LLM output.

## O6 — Connected evidence-first UI

- [x] Add an optimizer area to the authenticated application shell.
- [x] Show commit, detections, code evidence, provenance, confidence, unknowns, and gaps.
- [x] Collect minimal missing inputs and owner corrections.
- [x] Show cost ranges, gates, differences, effort, burden, payback, and reasoning.
- [x] Show catalog/pricing versions and stale warnings.
- [x] Add history and all loading, error, unsupported, ambiguous, stale, revoked, and
  deletion states.

**Exit:** Owners can inspect and challenge every consequential conclusion.

## O7 — Signed migration-spec handoff

- [x] Define MigrationSpecificationV1 with source/target, commit, evidence digests,
  preserved behavior, incompatibilities, paths, config/IaC changes, sequence, tests,
  rollout, rollback, cost range, assumptions, and unresolved decisions.
- [x] Generate prose only from validated structured inputs and schema-check AI output.
- [x] Sign the specification with catalog, pricing, prompt, and model versions.
- [x] Add a separate owner action: Authorize migration preparation.
- [x] Recheck permission, CSRF, commit, pricing, evidence, and confirmations.
- [x] Create a Software Oath run referencing the signed specification.

**Exit:** A recommendation becomes a bounded request while the repository stays unchanged.

## O8 — Private design-partner beta

- [x] Recruit 5–10 TypeScript repositories using Resend.
- [x] Publish supported patterns/providers and privacy terms.
- [x] Measure accuracy, corrections, unknowns, completion, recommendation distribution,
  plan generation, acceptance, and abandonment.
- [x] Have experienced engineers review every REPLACE result.
- [x] Review at least three migration specifications manually.
- [x] Verify source deletion and tenant isolation.

**Exit:** At least 80% of reports need no consequential capability correction, three
recommendations are actionable, and zero known incompatible replacements are proposed.

## O9 — Verified migration execution

- [x] Execute only from an owner-authorized signed specification.
- [x] Pin the analyzed commit or require reanalysis.
- [x] Use exact allowed paths and preserved behavior in the isolated runner.
- [x] Require repository-owned verification through the existing deterministic gate.
- [x] Prove each repository's migration-specific verification requirements.
- [x] Apply existing scope, proof, signing, artifact, CI, review, and attestation gates.
- [x] Run Infracost and bind raw digests when supported IaC changes.
- [x] Require human handling for secrets, DNS, data movement, cutover, and irreversible work.
- [x] Open only a verified draft PR.
- [x] Record reviewed effort and realized outcomes for design-partner migrations.

**Exit:** Two design-partner migrations reach verified draft PRs with complete
recommendation-to-attestation provenance and no failed evidence reaching approval.

The execution path now verifies the owner authorization and signature, binds the run
to the analyzed commit and exact paths, and routes the specification through the
existing repair gates. Repository-specific migration verification, reviewed outcomes,
and the two design-partner draft PRs remain evidence-dependent.

## O10 — Expansion

Expand in this order: object storage, image/media, Redis/cache, search, then AI/LLM.
Every category requires reviewed capability gates, positive and negative fixtures,
versioned compatibility and pricing, deterministic tests, operational review,
documentation, and design-partner evidence.

The deterministic expansion gate and its enforced sequencing are documented in
[OPTIMIZER_EXPANSION_GATES.md](OPTIMIZER_EXPANSION_GATES.md). It remains not ready
until O9 supplies two verified design-partner migrations and category-specific evidence.

Only then add billing connections, pricing alerts, recurring scans, paid plans, or
continuous optimization.

## Shared contracts

Add versioned ServiceObservation, CapabilityEvidence, OwnerUsageInput,
CompatibilityAssessment, PricingSnapshot, Recommendation, MigrationSpecification,
and MigrationOutcome records. Each includes tenant ownership, commit SHA, schema and
catalog/policy versions, provenance, timestamps, and content digest. Signed handoffs
reference immutable digests, not mutable rows.

## Success metrics

- Detection precision and recall by supported pattern.
- Capability accuracy and consequential owner-correction rate.
- Pricing completeness and staleness.
- Recommendation distribution and unresolved required facts.
- Reports completed and migration specifications generated.
- Engineer acceptance, rejection, and correction rates.
- Predicted versus reviewed effort and realized savings.
- Verified migrations reaching draft PR and owner merge or rejection.
- Any incompatible recommendation or evidence-boundary violation.

The primary early metric is the percentage of reports experienced engineers judge
technically accurate and safe to act upon—not estimated dollars found.

## Immediate execution order

1. Continue Software Oath M6 production hardening.
2. Complete O0 in parallel using fixtures and public/test repositories.
3. Implement O1 after its required M6 controls exist.
4. Prove O2–O5 as a headless engine before building the full UI.
5. Build O6 and validate it read-only with design partners.
6. Complete O7 only after recommendation trust is demonstrated.
7. Enable O9 for explicitly authorized design partners.
8. Use outcomes to choose O10 breadth and commercial packaging.

Immediate optimizer milestone:

> From a connected TypeScript repository using Resend, produce a read-only,
> evidence-backed SES/Postmark comparison, distinguish facts from assumptions,
> conservatively recommend KEEP/INVESTIGATE/REPLACE, and generate a signed migration
> specification without modifying the repository.

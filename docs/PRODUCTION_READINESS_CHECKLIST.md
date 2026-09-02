# Dependency Optimizer production readiness checklist

This checklist is derived from the production gates in [DEPENDENCY_OPTIMIZER_ROADMAP.md](DEPENDENCY_OPTIMIZER_ROADMAP.md). It is intended to support evidence-based go/no-go decisions.

## Decision rule

- Default state: no-go for broad production launch.
- A release may proceed only when every required item in this checklist is marked PASS with evidence.
- Any missing or unverified critical control keeps the project in pilot-only mode.

---

## 1) Trust and security gate

- [ ] M6 security controls are implemented and validated.
  - Owner: ______________
  - Evidence: ______________
- [ ] Retention policy is enforced for all raw repository evidence.
  - Owner: ______________
  - Evidence: ______________
- [ ] Recovery and deletion flows are tested and documented.
  - Owner: ______________
  - Evidence: ______________
- [ ] Rate limiting and abuse protections are active.
  - Owner: ______________
  - Evidence: ______________
- [ ] Observability and audit logging are wired for all optimizer runs.
  - Owner: ______________
  - Evidence: ______________
- [ ] Source files and environment values never leave the isolated runner.
  - Owner: ______________
  - Evidence: ______________
- [ ] Read-only analysis remains read-only until explicit owner authorization.
  - Owner: ______________
  - Evidence: ______________

---

## 2) Evidence integrity gate

- [ ] Every recommendation includes provenance, evidence, assumptions, and confidence.
  - Owner: ______________
  - Evidence: ______________
- [ ] Required capabilities are enforced as gates; no opaque aggregate score overrides failed gates.
  - Owner: ______________
  - Evidence: ______________
- [ ] Missing required evidence returns INSUFFICIENT_DATA or INCOMPATIBLE, never REPLACE.
  - Owner: ______________
  - Evidence: ______________
- [ ] Facts, inferences, and assumptions are kept separate in UI and storage.
  - Owner: ______________
  - Evidence: ______________
- [ ] Pricing sources, versions, effective dates, and staleness are tracked.
  - Owner: ______________
  - Evidence: ______________
- [ ] No secret or environment value is analyzed or exposed.
  - Owner: ______________
  - Evidence: ______________

---

## 3) Deterministic decision gate

- [ ] Catalogs, compatibility rules, pricing, and thresholds are deterministic and versioned.
  - Owner: ______________
  - Evidence: ______________
- [ ] The recommendation engine is driven by schema-validated logic, not freeform LLM output.
  - Owner: ______________
  - Evidence: ______________
- [ ] KEEP / INVESTIGATE / REPLACE / INSUFFICIENT_DATA decisions are reproducible.
  - Owner: ______________
  - Evidence: ______________
- [ ] A recommendation cannot modify a repository or open a PR by itself.
  - Owner: ______________
  - Evidence: ______________
- [ ] Software Oath never approves or merges its own migration.
  - Owner: ______________
  - Evidence: ______________

---

## 4) Repository-change execution gate

- [ ] Migration authorization is a separate, explicit owner action.
  - Owner: ______________
  - Evidence: ______________
- [ ] Analyzed commit is pinned or reanalysis is required.
  - Owner: ______________
  - Evidence: ______________
- [ ] Allowed paths are strict and enforced.
  - Owner: ______________
  - Evidence: ______________
- [ ] The isolated runner preserves behavior and verifies before PR creation.
  - Owner: ______________
  - Evidence: ______________
- [ ] Secrets, DNS, data movement, cutover, and irreversible work remain human-controlled.
  - Owner: ______________
  - Evidence: ______________
- [ ] A verified draft PR is the only artifact created for execution flows.
  - Owner: ______________
  - Evidence: ______________

---

## 5) Design-partner evidence gate

- [ ] 5–10 TypeScript repositories using Resend have completed beta participation.
  - Owner: ______________
  - Evidence: ______________
- [ ] Accuracy, corrections, unknowns, completion rate, and abandonment are measured.
  - Owner: ______________
  - Evidence: ______________
- [ ] Every REPLACE result is reviewed by experienced engineers.
  - Owner: ______________
  - Evidence: ______________
- [ ] At least three migration specifications are manually reviewed.
  - Owner: ______________
  - Evidence: ______________
- [ ] Source deletion and tenant isolation are verified.
  - Owner: ______________
  - Evidence: ______________
- [ ] At least 80% of reports require no consequential correction.
  - Owner: ______________
  - Evidence: ______________
- [ ] Zero known incompatible replacements are proposed.
  - Owner: ______________
  - Evidence: ______________

---

## 6) Verified migration execution gate

- [ ] Each repository’s migration-specific verification requirements are proven.
  - Owner: ______________
  - Evidence: ______________
- [ ] Owner-authorized signed specification is required.
  - Owner: ______________
  - Evidence: ______________
- [ ] Repository-owned verification passes the deterministic gate.
  - Owner: ______________
  - Evidence: ______________
- [ ] Infracost and other supported IaC checks are bound to the run.
  - Owner: ______________
  - Evidence: ______________
- [ ] Reviewed effort and realized outcomes are recorded for design-partner migrations.
  - Owner: ______________
  - Evidence: ______________
- [ ] Two design-partner migrations reach verified draft PRs with complete provenance.
  - Owner: ______________
  - Evidence: ______________

---

## 7) Launch approval

- [ ] All required gates above are PASS.
- [ ] No blocking issue remains open.
- [ ] Product owner signs off for pilot scope.
  - Name: ______________
  - Date: ______________
- [ ] Broad production launch is deferred until evidence remains green over time.
  - Owner: ______________
  - Evidence: ______________

---

## Final decision

- Status: ______________
- Launch scope: ______________
- Risk note: ______________
- Approver: ______________
- Date: ______________

# Dependency Optimizer private beta contract

## Participation boundary

The private beta accepts TypeScript and JavaScript repositories with an owner-confirmed
Resend integration. Supported runtime evidence is limited to direct SDK use and simple
local wrappers with visible call sites. The compared alternatives are Amazon SES and
Postmark using the versioned catalogs documented in
[OPTIMIZER_SUPPORT.md](OPTIMIZER_SUPPORT.md).

Generated, vendored, example, documentation, fixture, mock, and test-only code does not
activate a service. Dynamic loading, deep dependency injection, reflection, external
dashboard-only behavior, other languages, and unreviewed provider features are reported
as unsupported or unknown. They never produce an automatic replacement recommendation.

## Privacy and repository handling

Analysis uses an immutable checkout in a network-disabled ephemeral runner. The checkout
is read-only, repository dependencies are not installed, and repository code is never
executed. The checkout is destroyed after normalized evidence is returned. Environment
variable names may be observed; values and untracked files are not read or retained.

Retained data is limited to repository identity, commit, normalized file/line evidence,
provenance, confidence, owner inputs and corrections, catalog/policy versions, signed
migration specifications, result digests, and audit events. Complete source checkouts,
secret values, and automatic billing data are not retained. The detailed implementation
contract is [OPTIMIZER_DATA_POLICY.md](OPTIMIZER_DATA_POLICY.md).

Repository owners can disconnect and delete repository data through the authenticated,
permission-checked deletion action. Deletion removes optimizer analyses and dependent
repository records from both supported control-plane stores and deletes local artifacts.
Provider backup retention follows the production recovery policy.

## Review and safety process

- Owners confirm or correct service observations and supply unresolved usage facts.
- Experienced engineers review every `REPLACE` result during the beta.
- At least three signed migration specifications receive manual review before O8 exits.
- A recommendation never modifies a repository. Migration preparation requires a
  separate, current, CSRF-protected owner authorization.
- Secrets, DNS, data movement, cutover, approval, merge, and deployment remain human
  responsibilities.

## Measurements

The beta records detection/capability corrections, unknowns, report completion or
abandonment, deterministic recommendation distribution, migration-spec generation,
engineer actionability review, and owner acceptance or rejection. Metrics contain stable
analysis identifiers and aggregate labels, not repository source or secret values.

O8 exits only when at least 80% of reviewed reports need no consequential capability
correction, three recommendations are judged actionable, at least three migration
specifications are manually reviewed, and no known incompatible replacement is proposed.

Copy [optimizer-beta-evidence.example.json](optimizer-beta-evidence.example.json), add
one privacy-preserving review per analysis, and evaluate the deterministic exit gate:

    npm run optimizer:beta-readiness -- /secure/optimizer-beta-evidence.json

The command reports completion, abandonment, unknowns, corrections, recommendation
distribution, plan generation/review, engineer actionability, and owner outcomes. It
exits nonzero until every O8 evidence gate passes.

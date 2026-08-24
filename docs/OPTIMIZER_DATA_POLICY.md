# Dependency Optimizer data policy

## Status

This is the implementation contract for optimizer O0. Private customer repository
analysis remains disabled until the applicable Software Oath M6 controls are complete.

## Data classes

Every consequential value is labeled observed, inferred, owner-confirmed,
provider-derived, assumed, or estimated. An inference or assumption must never
silently become an observed or owner-confirmed fact.

## Repository handling

The target hosted flow is an immutable read-only checkout, isolated static analysis,
normalized evidence extraction, and checkout destruction. The analyzer must not
install dependencies, execute repository code, inspect untracked files, follow
repository-controlled network instructions, or read .env values.

Environment-variable names in tracked templates may be analyzed. Values must not be
stored, logged, placed in artifacts, or sent to a model.

## Retained records

The optimizer may retain repository identity and commit SHA, normalized observations,
file and line references, minimal review snippets and their digests, provenance,
confidence, owner corrections, catalog and policy versions, result digests, and audit
events. It must not retain a complete checkout merely for convenience.
Owner corrections are append-only records that remain distinct from observed analyzer
output and include current repository authorization plus an audit event.

## Model boundary

Do not send whole repositories to an AI provider. Deterministic parsing runs first.
Only the smallest relevant fragments may be sent for semantic interpretation after
secret redaction and tenant authorization. Customer code must not be used for model
training. Provider, purpose, input digest, prompt/schema versions, and retention
behavior must be auditable without logging raw secrets.

## Deletion and retention

Before private beta, the control plane must provide organization-scoped retention,
user-triggered evidence deletion, terminal-state checkout cleanup, artifact deletion
with an audit event, abandoned-analysis expiry, backup-retention documentation, and
tenant-isolation tests. Deleting an input invalidates dependent recommendations and
migration handoffs.

## Authorization

Repository access reuses the read-only GitHub App. Owner corrections, usage
confirmations, plan generation, deletion, and migration authorization require current
tenant and repository permission. A recommendation is not permission to modify a
repository. Software Oath requires separate CSRF-protected authorization and
revalidates commit and evidence freshness before execution.

# Repository dependency graph

Software Oath builds an evidence-backed graph from each completed optimizer analysis.
The graph answers a bounded question:

> What repository evidence is connected to this external service, and what is likely
> to be affected if the service is removed?

## Current nodes

- Detected external services.
- Required and optional capabilities.
- Runtime packages and imports.
- Environment-variable names. Values and secrets are never read.
- Infrastructure declarations found in tracked Terraform and Compose files.
- Source files containing the supporting evidence.

## Current edges

Every edge retains the normalized file, line, reason, provenance, and confidence that
created it. Relationships are explicit: `requires`, `imports`, `configures`,
`declares`, or `invokes`.

## Removal analysis

Selecting a service traverses its incoming graph edges. Immediate neighbors are
reported as direct impact; their dependents are reported as indirect impact. The UI
then derives:

- blast-radius level and counts;
- affected capabilities, configuration, packages, infrastructure, and files;
- a concise description of likely breakage;
- a staged migration and verification checklist;
- file-and-line evidence for each inspected node.

The result is static-analysis evidence, not a claim of complete runtime observability.
Dynamic loading, reflection, remote configuration, generated code, untracked
deployment state, and undocumented operational dependencies may remain unknown. A
missing edge therefore means "not established by the analyzed evidence," not "safe
to remove." Software Oath must continue to expose those coverage gaps explicitly.

## Next analysis depth

The next useful expansion is symbol and data-flow analysis: route-to-function calls,
database client-to-query/table relationships, queue producers and consumers, webhook
senders and handlers, tests that cover affected paths, and deployment resources. Each
new edge type should ship with positive and negative fixtures before it influences a
removal recommendation.

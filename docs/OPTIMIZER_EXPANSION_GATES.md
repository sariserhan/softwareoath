# Dependency Optimizer category expansion gates

Category expansion is blocked until O9 produces two verified design-partner draft pull
requests. The order is fixed: object storage, image/media, Redis/cache, search, then
AI/LLM. A later category cannot bypass an unfinished earlier category.

Every category requires all of the following before implementation is described as
ready:

- reviewed capability and pricing catalogs;
- reviewed positive and negative fixtures;
- deterministic detection, compatibility, pricing, and recommendation tests;
- operational and privacy review;
- published support boundaries and limitations; and
- reviewed design-partner evidence.

`evaluateOptimizerExpansionReadiness` enforces these prerequisites in code. Catalog
experiments may be developed privately, but the product must not activate a category,
claim support, or generate migration authorization until the evaluator passes.

Billing connections, pricing alerts, recurring scans, paid plans, continuous
optimization, and category-specific migration execution remain blocked until the same
evidence chain exists for the active category.

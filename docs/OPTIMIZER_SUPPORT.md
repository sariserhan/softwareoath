# Dependency Optimizer initial support contract

## O0 corpus

The reviewed corpus under fixtures/optimizer defines the first evaluation boundary.

Supported evidence patterns:

- Direct Resend SDK initialization and runtime calls.
- HTML, text, attachment, and delivery-webhook examples.
- A simple local wrapper with a visible runtime call site.
- Tracked environment-variable names as ambiguous evidence.

Required false-positive behavior:

- A manifest dependency without runtime use is inactive.
- README examples and comments do not activate a service.
- An environment-variable name alone does not prove active use.
- Empty expected and observed labels score as a correct negative.

Not yet supported:

- Minified, generated, or vendored source.
- Runtime module loading that cannot be resolved statically.
- Deep dependency-injection or reflection-based wrappers.
- Calls constructed dynamically across process boundaries.
- Provider behavior existing only in an external dashboard.
- Usage, contract pricing, deliverability, or dedicated-IP needs inferred from code.
- Languages other than TypeScript and JavaScript.
- Providers other than Resend, SES, and Postmark.

## Accuracy gate

The first detector must achieve at least 95% service-detection precision on the
reviewed corpus. Recall is reported by supported pattern and may not be hidden in a
combined confidence score. A consequential unsupported or ambiguous pattern produces
an owner-visible unknown rather than a replacement recommendation.

The corpus is a starting contract, not evidence of production accuracy. Public and
design-partner repositories require independent review before support claims expand.

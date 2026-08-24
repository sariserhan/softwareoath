# Dependency Optimizer initial support contract

## O0 corpus

The reviewed corpus under fixtures/optimizer defines the first evaluation boundary.

Supported evidence patterns:

- Direct Resend SDK initialization and runtime calls.
- Individual and batch sends, HTML/text, attachments, provider templates,
  provider-side scheduling, delivery webhooks, and inbound email.
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

The current 11-repository gold corpus scores 100% precision and 100% recall for active
Resend detection, with exact expected capability labels in every fixture. This is a
reproducible fixture result, not a production-accuracy claim. Reviewed public
repositories and owner correction data remain required before expanding it.

## Public repository evaluation

Run `npm run optimizer:evaluate-public` to clone six manually reviewed repositories
at immutable commits into a temporary directory, analyze them without installing or
executing their code, print machine-readable results, and remove every checkout.
Only repository identity, commit, expected labels, reviewed paths, and notes are kept
in `fixtures/optimizer/public-repositories.json`.

The 2026-08-24 set contains four active integrations and two TypeScript negative
controls. It produced 100% precision, 100% recall, six of six exact status matches,
six of six exact capability-set matches, and zero unsupported analyses. The review
added support for React Email bodies passed through a multi-transport wrapper. Six
repositories remain a small validation set, not a production-accuracy guarantee.

The corpus is a starting contract, not evidence of production accuracy. Public and
design-partner repositories require independent review before support claims expand.

## O3 email compatibility catalog

The versioned `email-2026-08-24` catalog compares observed Resend requirements with
SES and Postmark across transactional send, HTML/text bodies, attachments, provider
templates, batch sends, scheduling, tags, idempotency, delivery webhooks, inbound
email, contacts/audiences, and sending domains. Each observed capability retains its
source evidence, inference reason, confidence, and required-versus-optional status.

Compatibility is deterministic and conservative. A target capability is classified
as exact, supported with changes, unsupported, or unverified. Any required
unsupported or unverified capability fails the compatibility gate; an aggregate
score cannot hide that failure. Optional gaps remain visible but do not block the
target. Catalog results include the catalog version, verification date, and the
official provider documentation used for the capabilities actually assessed.

SES and Postmark require migration work for several features, including templates,
attachments, batch semantics, webhooks, inbound processing, and domain verification.
Native Resend-style scheduling and idempotency are not treated as supported by either
target. SES contact lists are supported with semantic changes; Postmark is treated as
unsupported for a Resend-equivalent contact/audience store. Unknown capability names
remain unverified rather than being guessed.

The catalog also exposes unresolved owner inputs instead of inferring operational
fitness from code: deliverability and reputation ownership, quotas, AWS region and
sandbox state, message streams, dedicated IP needs, compliance/data residency,
webhook operations, and support requirements. These inputs must be resolved before a
later recommendation stage can claim operational suitability. Prices and economic
recommendations are outside O3 and begin in O4.

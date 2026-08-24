# AI SaaS Dependency Optimizer

## 1. Product Summary

Build a web application that connects to a developer's GitHub repository, detects external SaaS and infrastructure dependencies, determines how those services are actually used in the codebase, compares them against compatible alternatives, and recommends whether each dependency should be:

* **KEEP**
* **OPTIMIZE**
* **REPLACE**

The product must not behave like a generic pricing-comparison website.

Its core differentiator is:

> Analyze the customer's actual code first, determine the capabilities the application requires, then recommend cheaper or better-fit alternatives only when the replacement is technically compatible and financially worthwhile.

Long-term, the system can generate agent-ready migration instructions and eventually perform migrations automatically.

---

# 2. Core User Promise

> Connect your repository and find out whether you're using the right developer services for what your application actually needs.

The system should answer:

* What external services does this repository depend on?
* Where are they used?
* Which capabilities of each service are actually being used?
* How difficult would that service be to replace?
* What compatible alternatives exist?
* What would each alternative cost?
* How much would migration save?
* Is migration worth the engineering effort and operational risk?
* What files/configuration/DNS/infrastructure would have to change?

---

# 3. Example

The system detects:

```text
Resend
OpenAI
Cloudinary
Upstash
Vercel
Neon
Sentry
```

It analyzes actual usage and returns:

```text
Cloudinary
REPLACE

Current estimated cost: $89/month
Recommended: Cloudflare R2 + image transformation
Estimated cost: $14/month
Estimated savings: $75/month
Annual savings: $900

Compatibility: 96%
Migration difficulty: Medium
Affected files: 8
Estimated engineering effort: 4–6 hours
Payback period: ~1.5 months

Reason:
The application uses uploads, image delivery and resizing.
It does not use Cloudinary-specific AI transformation,
DAM, video processing or advanced media workflows.
```

Another result:

```text
Resend
KEEP

Current estimated cost: $20/month
SES estimated cost: $4/month
Potential savings: $16/month

Migration difficulty: Medium
Operational complexity increase: High
Estimated payback period: 18+ months

Recommendation:
Keep Resend.
```

The product must be willing to recommend **KEEP**.

---

# 4. MVP Scope

## Included

The MVP must support:

1. User authentication.
2. GitHub connection.
3. Repository selection.
4. Repository scanning.
5. External service detection.
6. Detection of service usage locations.
7. Capability inference.
8. User confirmation/editing of detected services.
9. Usage-input collection where usage cannot be inferred.
10. Service compatibility analysis.
11. Pricing comparison.
12. Migration-risk scoring.
13. Savings calculation.
14. KEEP / OPTIMIZE / REPLACE recommendation.
15. Detailed recommendation page.
16. Agent-ready migration specification generation.
17. Analysis history.
18. Admin dashboard.
19. Stripe billing.
20. Email notifications.

Do not automatically modify repositories in MVP.

Do not automatically open pull requests in MVP.

Do not automatically migrate production infrastructure.

Those are later phases.

---

# 5. Initial Service Categories

Start with categories where substitution is realistic.

## Tier 1

### Transactional Email

Detect:

* Resend
* SendGrid
* Postmark
* Brevo
* Mailgun
* Amazon SES

Compare capabilities such as:

* transactional sending
* batch sending
* templates
* contacts
* audiences
* attachments
* inbound email
* webhooks
* domain management
* analytics

---

### AI / LLM

Detect:

* OpenAI
* Anthropic
* Gemini
* Groq
* Mistral
* OpenRouter

Analyze:

* model used
* structured output
* JSON mode
* tool calling
* vision
* embeddings
* streaming
* context requirements
* reasoning requirements
* batch operations

AI recommendations may include **OPTIMIZE**, not just replacement.

Example:

```text
Keep Claude for complex reasoning.
Move extraction/classification calls to Gemini.
```

---

### Object Storage

Detect:

* AWS S3
* Cloudflare R2
* Backblaze B2
* Supabase Storage

Analyze:

* uploads
* downloads
* presigned URLs
* multipart uploads
* object lifecycle
* event notifications
* replication
* public buckets
* egress requirements

---

### Image / Media

Detect:

* Cloudinary
* ImageKit
* Uploadcare
* Cloudflare Images
* Vercel Image Optimization

Analyze actual transformation requirements.

---

### Redis / Cache

Detect:

* Upstash Redis
* Redis Cloud
* AWS ElastiCache
* managed Redis integrations

Analyze:

* basic key/value
* TTL
* pub/sub
* streams
* sorted sets
* Lua/scripts
* rate limiting
* persistence assumptions

---

### Search

Detect:

* Algolia
* Typesense
* Meilisearch
* Elasticsearch/OpenSearch

Analyze:

* typo tolerance
* faceting
* filters
* ranking
* geo search
* autocomplete
* vector search
* indexing volume

---

# 6. Later Categories

Do not prioritize these for the first release.

* authentication
* databases
* hosting
* observability
* analytics
* queues
* SMS
* maps
* CDN
* realtime
* payments

These categories carry higher migration risk.

Stripe should generally default toward **KEEP** unless there is a compelling reason otherwise.

---

# 7. Repository Analysis Pipeline

Create the following analysis pipeline:

```text
GitHub Repository
      ↓
Repository Metadata
      ↓
Manifest Detection
      ↓
Dependency Detection
      ↓
Environment Variable Detection
      ↓
Import / SDK Detection
      ↓
API Usage Analysis
      ↓
Capability Inference
      ↓
Usage Estimation
      ↓
Alternative Matching
      ↓
Pricing Calculation
      ↓
Migration Analysis
      ↓
Recommendation Engine
      ↓
Report
```

---

# 8. Files to Analyze

At minimum inspect:

```text
package.json
package-lock.json
pnpm-lock.yaml
yarn.lock

requirements.txt
pyproject.toml
Pipfile

go.mod
Cargo.toml

.env.example
.env.template

Dockerfile
docker-compose.yml

vercel.json
wrangler.toml
netlify.toml

terraform/
*.tf

.github/workflows/

README.md

source files
```

Never require access to `.env` secrets.

Do not ingest secrets.

---

# 9. Detection Methods

Dependency detection should combine several strategies.

## Package Detection

Example:

```json
{
  "resend": "^..."
}
```

maps to:

```text
service = Resend
category = email
confidence = high
```

---

## Import Detection

Example:

```typescript
import { Resend } from "resend";
```

---

## Environment Variable Detection

Example:

```text
RESEND_API_KEY
OPENAI_API_KEY
CLOUDINARY_URL
UPSTASH_REDIS_REST_URL
```

Environment-variable values must never be stored.

Only names may be analyzed.

---

## Endpoint Detection

Example:

```text
api.openai.com
api.resend.com
api.cloudinary.com
```

---

## Infrastructure Detection

Examples:

```text
Terraform resources
Vercel integrations
Cloudflare bindings
Docker services
AWS SDK usage
```

---

# 10. Capability Analysis

Detecting a service alone is insufficient.

The system must determine which service capabilities the application actually depends upon.

Example:

```typescript
await resend.emails.send({
  from,
  to,
  subject,
  html,
  attachments
});
```

Infer:

```text
service: Resend

required capabilities:
- transactional_send
- html_email
- attachments

not observed:
- inbound
- audiences
- batch
- templates
```

Each inferred capability must include:

```text
capability
confidence
evidence file
evidence location
reason
```

---

# 11. Evidence Model

Every significant conclusion must have supporting evidence.

Example:

```json
{
  "service": "resend",
  "capability": "attachments",
  "confidence": 0.98,
  "evidence": [
    {
      "file": "src/lib/email.ts",
      "line_start": 42,
      "line_end": 49
    }
  ]
}
```

The UI should allow users to inspect why the system reached a conclusion.

---

# 12. AI Responsibilities

Use AI where semantic interpretation is required.

AI may:

* identify service usage patterns
* understand wrappers around SDKs
* infer capabilities
* summarize architectural usage
* estimate migration complexity
* produce migration specifications

AI must NOT own:

* pricing arithmetic
* compatibility truth
* service capability definitions
* account permissions
* billing logic
* recommendation thresholds
* schema validation

Those must be deterministic code/data.

Principle:

> AI interprets. Code owns facts, arithmetic, rules, validation and final decisions.

---

# 13. Service Knowledge Base

This is a core product asset.

Create normalized records for each supported service.

Example:

```json
{
  "id": "resend",
  "name": "Resend",
  "category": "email",
  "capabilities": [
    "transactional_send",
    "batch_send",
    "attachments",
    "webhooks",
    "contacts",
    "inbound"
  ],
  "pricing_model": {},
  "limits": {},
  "alternatives": [
    "aws_ses",
    "postmark",
    "brevo"
  ]
}
```

---

# 14. Compatibility Matrix

Compatibility must operate at the capability level.

Example:

```text
Resend → SES

transactional_send     YES
html_email             YES
attachments            YES
batch_send              PARTIAL
contacts                NO
inbound                 DIFFERENT
templates               DIFFERENT
```

Calculate compatibility only against the capabilities the customer actually uses.

Example:

Customer uses:

```text
transactional_send
html_email
attachments
```

SES compatibility:

```text
100%
```

Another customer uses:

```text
transactional_send
contacts
audiences
```

SES compatibility may be:

```text
65%
```

Same source service, different recommendation.

---

# 15. Pricing Engine

Pricing must be deterministic and versioned.

Do not ask an LLM to calculate prices.

Each provider should have structured pricing rules.

Example:

```json
{
  "service": "aws_ses",
  "effective_date": "2026-08-01",
  "unit": "email",
  "tiers": []
}
```

Store:

* free tier
* monthly minimum
* included usage
* overages
* request cost
* storage cost
* egress
* special charges
* regions where relevant
* pricing source
* effective date
* last verified date

Never silently use stale pricing.

---

# 16. Usage Collection

Usage can come from three sources.

## A. Static inference

Example:

```text
Application clearly sends transactional emails.
```

But static analysis usually cannot know monthly volume.

---

## B. User Input

Ask:

```text
Approximately how many transactional emails do you send monthly?
```

Keep questions minimal.

---

## C. Provider Connections — Later

Future integrations may retrieve:

* billing
* quotas
* usage
* storage
* request counts

MVP should not require provider billing integrations.

---

# 17. Recommendation Engine

Each detected dependency must receive one of:

```text
KEEP
OPTIMIZE
REPLACE
INSUFFICIENT_DATA
```

Recommendations must consider more than raw price.

Use a deterministic scoring model based on:

```text
estimated annual savings
compatibility
migration effort
migration risk
operational complexity
vendor maturity
performance implications
lock-in change
maintenance burden
```

Conceptually:

```text
Actual Value =
Expected Savings
- Migration Cost
- Operational Cost Increase
- Risk Cost
```

Do not expose fake precision where values are estimates.

---

# 18. Migration Difficulty

Classification:

```text
TRIVIAL
LOW
MEDIUM
HIGH
VERY_HIGH
```

Factors:

* files affected
* SDK replacement
* API-semantic differences
* data migration
* DNS changes
* authentication changes
* infrastructure changes
* deployment changes
* schema changes
* operational burden
* irreversible steps

---

# 19. Payback Period

Calculate:

```text
migration_cost_estimate / monthly_savings
```

Example:

```text
Annual savings: $720
Estimated engineering cost: $240
Payback: ~4 months
```

If payback is poor:

```text
Recommendation: KEEP
```

---

# 20. Analysis Report

Main report should contain:

```text
Current estimated monthly cost
Optimized estimated monthly cost
Potential monthly savings
Potential annual savings
Services analyzed
Recommended replacements
Recommended optimizations
Services to keep
```

Example:

```text
CURRENT STACK

Vercel       KEEP
Neon         KEEP
Resend       KEEP
Cloudinary   REPLACE
OpenAI       OPTIMIZE
Upstash      KEEP


Potential savings
$118/month

Estimated annual savings
$1,416
```

---

# 21. Service Detail Page

Each service should show:

### Current service

```text
Cloudinary
```

### Usage detected

```text
Upload
Resize
WebP conversion
Signed URLs
```

### Evidence

```text
src/lib/image.ts
src/app/api/upload/route.ts
```

### Alternative

```text
Cloudflare R2 + Images
```

### Compatibility

```text
96%
```

### Cost

```text
Current: ~$89/month
Alternative: ~$14/month
```

### Savings

```text
~$75/month
```

### Difficulty

```text
Medium
```

### Recommendation

```text
REPLACE
```

### Explanation

Human-readable reasoning.

---

# 22. Agent-Ready Migration Spec

Every REPLACE or OPTIMIZE recommendation should support:

```text
Generate Migration Plan
```

The output must be suitable for:

* Codex
* Claude Code
* Cursor
* GitHub Copilot agent
* another coding agent

Example:

```text
Goal:
Migrate Cloudinary image storage and transformations
to Cloudflare R2 + Cloudflare Images.

Current implementation:
...

Affected files:
...

Required behavior to preserve:
...

Required infrastructure:
...

Environment variables:
...

Code changes:
...

Migration sequence:
...

Data migration:
...

Testing requirements:
...

Rollback procedure:
...

Expected savings:
...

Known incompatibilities:
...
```

The agent specification must never claim compatibility that the analyzer has not verified.

---

# 23. GitHub Integration

Use a GitHub App rather than requesting broad personal-access tokens.

Permissions should be minimal.

MVP requirements:

```text
Read repository metadata
Read source code
Read manifests/configuration
```

Do not require:

```text
write access
PR creation
deployment access
secrets access
```

Make read-only status obvious to the user.

---

# 24. Security

Security is critical because customers provide source-code access.

Requirements:

* encrypt tokens at rest
* minimum GitHub permissions
* never log access tokens
* never store `.env` values
* redact detected secrets
* avoid sending entire repositories to LLM providers
* send only relevant code fragments where possible
* tenant isolation
* deletion controls
* repository-data retention policy
* complete audit trail
* user-triggered repository-data deletion

Do not train models using customer code.

State this clearly.

---

# 25. Repository Storage Strategy

Prefer temporary analysis over permanent source-code storage.

Recommended approach:

```text
clone / retrieve
      ↓
analyze in isolated environment
      ↓
extract normalized findings
      ↓
discard source code
```

Persist:

```text
dependency findings
capabilities
evidence references
analysis metadata
recommendations
```

Do not persist the entire repository unnecessarily.

---

# 26. Suggested Stack

Use:

```text
Next.js latest
TypeScript
Tailwind
shadcn/ui
Vercel
```

Database:

```text
Postgres via Neon or Supabase
```

ORM:

```text
Drizzle ORM
```

Authentication:

```text
Better Auth or Clerk
```

Billing:

```text
Stripe
```

Email:

```text
Resend
```

Monitoring:

```text
Sentry
```

Analytics:

```text
PostHog
```

GitHub:

```text
GitHub App + GitHub REST/GraphQL APIs
```

For long-running scans, use a proper background job architecture rather than holding open an HTTP request.

---

# 27. Suggested Data Model

## users

```text
id
email
name
created_at
updated_at
```

## organizations

```text
id
name
owner_user_id
stripe_customer_id
plan
created_at
updated_at
```

## repositories

```text
id
organization_id
github_repository_id
owner
name
default_branch
last_analyzed_commit
created_at
updated_at
```

## analyses

```text
id
repository_id
commit_sha
status
started_at
completed_at
estimated_current_monthly_cost
estimated_optimized_monthly_cost
estimated_monthly_savings
analysis_version
```

## services

Internal service catalog.

```text
id
slug
name
category
website
```

## detected_dependencies

```text
id
analysis_id
service_id
confidence
detection_method
summary
```

## dependency_evidence

```text
id
detected_dependency_id
file_path
line_start
line_end
evidence_type
metadata
```

## capabilities

```text
id
slug
category
name
```

## detected_capabilities

```text
id
detected_dependency_id
capability_id
confidence
evidence
```

## service_capabilities

```text
service_id
capability_id
support_level
notes
```

## pricing_versions

```text
id
service_id
effective_date
currency
pricing_json
source_url
verified_at
```

## recommendations

```text
id
analysis_id
detected_dependency_id
type
target_service_id
compatibility_score
migration_difficulty
monthly_savings
annual_savings
estimated_migration_cost
payback_months
confidence
reasoning
```

## migration_plans

```text
id
recommendation_id
content
generator_version
created_at
```

---

# 28. Admin Dashboard

Every production website must have an internal admin dashboard.

Include:

## Control Center

* total users
* total organizations
* repositories connected
* analyses run
* successful scans
* failed scans

## Service Catalog

Manage:

* services
* categories
* capabilities
* compatibility
* migration mappings
* pricing

## Pricing Health

Show:

* last verified pricing date
* stale pricing
* failed pricing refreshes
* manual review needed

## Analysis Health

Show:

* scan duration
* errors
* model usage
* token cost
* repository-language distribution

## Revenue

* subscriptions
* MRR
* churn
* Stripe status

## Feature Flags

Allow staged rollout of:

* service categories
* providers
* migration generation
* experimental analyzers

---

# 29. Billing

Initial model:

## Free

```text
1 repository
limited scan
top 3 findings
```

## Pro

Example:

```text
$19–$29/month
```

Includes:

* multiple repositories
* full reports
* migration plans
* recurring rescans
* analysis history

## Team

Later.

Do not implement savings-based billing initially.

It creates attribution complexity.

---

# 30. Reanalysis

Store the analyzed commit SHA.

When user requests another scan:

```text
latest commit
vs
last analyzed commit
```

Prefer incremental analysis eventually.

MVP may perform full scans.

---

# 31. UX Flow

## Landing Page

Primary CTA:

```text
Analyze My Repository
```

Messaging:

> Find out which developer services your code should keep, optimize or replace.

---

## Authentication

Sign in.

---

## GitHub

```text
Connect GitHub
```

Install GitHub App.

---

## Repository Selection

Show allowed repositories.

---

## Scan

Progress UI:

```text
Inspecting dependencies...
Finding external services...
Tracing usage...
Mapping required capabilities...
Comparing alternatives...
Calculating costs...
Evaluating migration risk...
```

---

## Missing Data

If needed:

```text
We detected Resend.

Approximately how many emails do you send per month?
```

Do not interrupt users with questions the repository already answers.

---

## Results

Show:

```text
Potential savings
$74/month
```

Then recommendation cards.

---

# 32. Landing-Page Positioning

Avoid generic language such as:

> AI-powered FinOps.

Preferred:

> **Is your code using the right services?**

Supporting copy:

> Connect your GitHub repository. We analyze the SaaS and infrastructure services your application actually uses, then show which ones you should keep, optimize or replace.

Alternative:

> **Your code picked a stack. We check whether it's still the right one.**

---

# 33. Non-Goals

Do NOT build these initially:

* generic cloud FinOps
* AWS EC2 rightsizing
* Kubernetes optimization
* employee SaaS-license management
* simple provider comparison directory
* uptime monitoring
* API gateway
* automatic multi-provider routing
* automatic production migrations
* arbitrary repository rewriting
* full autonomous deployment
* vendor procurement

---

# 34. Critical Product Principles

## Principle 1

Do not recommend a replacement merely because it is cheaper.

## Principle 2

Understand actual capabilities used before calculating compatibility.

## Principle 3

Migration effort matters.

## Principle 4

Operational complexity matters.

## Principle 5

KEEP is a valid and valuable recommendation.

## Principle 6

Every conclusion should have traceable evidence.

## Principle 7

Pricing must be deterministic and current.

## Principle 8

Never expose customer code unnecessarily.

## Principle 9

Do not claim exact savings when inputs are estimated.

## Principle 10

The application must explain WHY.

---

# 35. Development Phases

## Phase 1 — Foundation

Implement:

* Next.js project
* database
* auth
* organizations
* Stripe
* admin foundation
* GitHub App
* repository selection

Commit when complete.

---

## Phase 2 — Repository Scanner

Implement:

* repository ingestion
* manifest parsing
* environment-variable-name parsing
* SDK/import detection
* API hostname detection
* normalized dependency records
* confidence scores

Initial supported services:

```text
Resend
OpenAI
Anthropic
Cloudinary
Upstash
S3
R2
Algolia
```

Commit when complete.

---

## Phase 3 — Capability Detection

For each supported service:

* identify SDK calls
* map calls to capabilities
* attach code evidence
* calculate confidence

Commit when complete.

---

## Phase 4 — Service Catalog

Implement:

* service records
* capability definitions
* compatibility mappings
* alternative mappings

Commit when complete.

---

## Phase 5 — Pricing Engine

Implement:

* pricing schemas
* pricing versions
* usage inputs
* deterministic calculations
* pricing citations/sources
* stale-price detection

Commit when complete.

---

## Phase 6 — Recommendation Engine

Implement:

```text
KEEP
OPTIMIZE
REPLACE
INSUFFICIENT_DATA
```

Use:

* compatibility
* savings
* migration difficulty
* operational complexity
* payback

Commit when complete.

---

## Phase 7 — Results UI

Implement:

* summary dashboard
* service cards
* detail views
* evidence viewer
* cost comparison
* recommendation reasoning

Commit when complete.

---

## Phase 8 — Migration Plan Generator

Generate agent-ready migration specifications.

Do not edit repository code.

Commit when complete.

---

## Phase 9 — Billing & Production

Add:

* Free/Pro limits
* Stripe Checkout
* webhook handling
* subscription state
* transactional email
* error states
* 404
* 500
* loading states
* skeletons
* monitoring

Commit when complete.

---

# 36. Testing Requirements

Use automated tests for:

* dependency detection
* false-positive prevention
* capability mapping
* compatibility calculation
* pricing calculation
* recommendation engine
* payback calculation
* authorization
* GitHub permissions
* tenant isolation
* Stripe webhook handling

Create fixture repositories containing supported integrations.

Example fixtures:

```text
fixtures/resend-basic
fixtures/resend-advanced
fixtures/cloudinary-basic
fixtures/s3-presigned
fixtures/openai-tools
fixtures/upstash-cache
```

A fixture must make it easy to prove:

```text
service detected correctly
capabilities detected correctly
incompatible replacement rejected
cost arithmetic correct
recommendation correct
```

---

# 37. False-Positive Protection

Do not mark a service as actively used solely because:

```text
it appears in README
it exists in an unused dependency
it occurs in comments
it exists in example code
```

Use evidence hierarchy.

Example:

```text
runtime API call       VERY HIGH
initialized SDK        HIGH
active import          HIGH
environment variable   MEDIUM
manifest dependency    MEDIUM
README mention         LOW
comment mention        IGNORE
```

---

# 38. Confidence

Every analysis result should include a confidence score.

Example:

```text
Service detection: 99%
Capability inference: 94%
Pricing estimate: 82%
Replacement compatibility: 96%
Savings estimate: 78%
```

Do not collapse all confidence into one meaningless number.

---

# 39. Success Metrics

Track:

```text
repositories scanned
services detected per repository
recommendations per analysis
% KEEP
% OPTIMIZE
% REPLACE
migration plans generated
repeat scans
free → paid conversion
estimated savings identified
recommendations rejected by users
```

Later:

```text
migrations actually completed
real savings vs projected savings
recommendation accuracy
```

---

# 40. Future Phases

## Phase A — Provider Billing Connections

Pull real usage/cost information.

---

## Phase B — GitHub Pull Requests

Generate migration branches automatically.

Require explicit user approval.

---

## Phase C — Sandbox Migration

Apply migration in isolated environment.

Run:

```text
install
lint
typecheck
unit tests
integration tests
build
```

---

## Phase D — Preview Deployment

Generate a preview environment.

Compare:

```text
before
after
```

---

## Phase E — Continuous Optimization

Monitor repository changes and pricing changes.

Example:

```text
A service changed pricing.

Your previous KEEP recommendation
is now REPLACE.

Potential savings: $63/month.
```

---

## Phase F — Autonomous Migration

Eventually:

```text
detect opportunity
      ↓
create branch
      ↓
perform migration
      ↓
run tests
      ↓
deploy preview
      ↓
calculate expected savings
      ↓
human approval
      ↓
merge
```

Do not permit production changes without explicit authorization.

---

# 41. Potential Moat

The moat is not simply repository scanning.

The proprietary asset should become the **developer-service compatibility graph**:

```text
Service
   ↓
Capabilities
   ↓
Observed API patterns
   ↓
Compatible services
   ↓
Semantic differences
   ↓
Migration mappings
   ↓
Operational differences
   ↓
Pricing
   ↓
Historical migration outcomes
```

Over time the system should know:

> If a repository uses Service A in pattern X, Service B can replace it with Y% compatibility and these exact migration requirements.

That dataset improves as more migrations are analyzed and validated.

---

# 42. Definition of MVP Complete

MVP is complete when a user can:

1. Create an account.
2. Connect GitHub.
3. Select a repository.
4. Run an analysis.
5. Automatically detect supported external services.
6. See exactly where each service is used.
7. See inferred capabilities.
8. Provide missing usage information.
9. Receive compatible alternatives.
10. See current and alternative estimated cost.
11. See migration difficulty.
12. Receive KEEP / OPTIMIZE / REPLACE.
13. Understand why.
14. Generate an agent-ready migration specification.
15. Return later and rerun the analysis.

Do not expand scope until this workflow works reliably.

---

# 43. Engineering Rules

* Use TypeScript strict mode.
* Validate external inputs with Zod.
* Keep service definitions strongly typed.
* Keep pricing calculations deterministic.
* Never trust LLM output without schema validation.
* Keep AI prompts versioned.
* Add migrations for all schema changes.
* Maintain `.env.example`.
* Never commit secrets.
* Add structured logging.
* Add Sentry.
* Add rate limiting.
* Add appropriate API authorization.
* Create reusable service interfaces rather than provider-specific logic throughout the codebase.
* Create a `DEVELOPER_HANDBOOK.md`.
* Document all local scripts.
* Maintain a repository TODO/roadmap.
* Commit after each completed task.
* Do not push unless explicitly instructed.

---

# 44. First Implementation Target

For the first working vertical slice, support only:

```text
Resend
AWS SES
Postmark
Brevo
```

The system should:

```text
GitHub repo
   ↓
detect Resend
   ↓
find where Resend is called
   ↓
determine Resend capabilities being used
   ↓
ask monthly email volume if unknown
   ↓
compare SES/Postmark/Brevo
   ↓
calculate cost
   ↓
calculate compatibility
   ↓
estimate migration difficulty
   ↓
return KEEP or REPLACE
   ↓
generate migration specification
```

Do not start by implementing all categories.

Prove this one vertical end-to-end first.

Once the Resend workflow is trustworthy, generalize the architecture and add additional service categories.

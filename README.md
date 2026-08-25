# Software Oath

[![CI](https://github.com/sariserhan/softwareoath/actions/workflows/ci.yml/badge.svg)](https://github.com/sariserhan/softwareoath/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.19-blue)](package.json)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey)](.)

**Software that keeps its promises.**

Software Oath is an evidence-first repository stewardship platform. It understands a codebase, remembers what matters, finds maintenance risks, prepares bounded repairs, verifies every change, measures infrastructure cost impact, and leaves the final decision with the repository owner.

Production: [softwareoath.com](https://softwareoath.com)<br>
Application: [softwareoath.com/dashboard](https://softwareoath.com/dashboard)

## Why Software Oath exists

Generating a change is easy. Trusting and accepting it is harder:

- Did it fix the selected problem?
- Did it touch only the allowed files?
- Did tests, type checks, policies, and security checks pass?
- Did it introduce new findings?
- Did infrastructure cost change?
- Can another person independently verify the evidence?
- Is the repository owner still in control?

Software Oath puts verification and approval between a proposed change and the repository receiving it. Coding agents may prepare repairs; Software Oath determines whether a repair is blocked, requires human review, or is ready for an owner decision.

    Repository or incident
            ↓
    Understand and remember
            ↓
    Prepare a bounded repair
            ↓
    Verify tests, policy, scope, findings, and cost
            ↓
    Block / Human review / Ready
            ↓
    Owner decides whether anything reaches GitHub

## Products and workflows

### Repository Steward

Repository Steward continuously understands and maintains a repository.

It can:

- inspect languages, frameworks, manifests, lockfiles, and infrastructure files;
- detect deterministic maintenance and dependency findings;
- build persistent repository knowledge;
- prepare one bounded repair in an isolated workspace;
- prove that the selected finding was resolved;
- detect new or blocking findings;
- enforce the repository oath;
- deliver an owner-reviewed draft pull request when authorized.

Software Oath never automatically merges a repair.

### Dependency Optimizer

Dependency Optimizer finds more than outdated packages. It analyzes how external services and libraries are actually used, identifies required capabilities and unknowns, compares supported alternatives, records owner corrections, and prepares signed migration specifications.

Current capabilities include:

- npm update and advisory workflows;
- isolated native advisory scans for pnpm, Python, Rust, and Go;
- registered-service and capability detection;
- Resend usage analysis;
- owner-confirmed usage and correction workflows;
- deterministic compatibility and pricing catalogs;
- signed, owner-authorized migration specifications;
- explicit coverage gaps when evidence is insufficient.

See the [Dependency Optimizer roadmap](docs/DEPENDENCY_OPTIMIZER_ROADMAP.md) and [support policy](docs/OPTIMIZER_SUPPORT.md).

### Incident Replay

Incident Replay reproduces a historical incident at its original buggy commit, confirms the selected finding, runs the bounded repair workflow, and compares the result with the known human fix.

Use it to benchmark repair quality, measure scope compliance and latency, prevent regressions, validate runner or policy changes, and preserve replay reports as evidence.

### Cost Analysis

Cost Analysis measures infrastructure cost before and after a proposed repair.

When infrastructure files are present, Software Oath preserves:

- baseline and proposed monthly cost;
- absolute and percentage change;
- affected projects and resources;
- unsupported resources;
- policy decisions and reasons;
- Infracost runner identity;
- SHA-256 digests of raw cost evidence.

A repository oath can require an estimate and block repairs that exceed owner-defined cost limits. Cost Analysis becomes available after a repair produces infrastructure evidence.

### Cryptographic Evidence

Software Oath produces independently verifiable evidence:

- Ed25519-signed repair receipts;
- patch and artifact SHA-256 digests;
- verified final owner-decision attestations;
- exportable attestation bundles;
- SHA-256 Merkle roots;
- versioned evidence and runner identity.

Receipts are verified again before review, application, delivery, or approval.

## Permission-later public repository scans

A public repository can be scanned without GitHub sign-in. Paste a public URL such as:

    https://github.com/owner/repository

Software Oath then:

1. accepts only a strict public GitHub repository URL;
2. normalizes the clone source on the server;
3. queues a read-only stewardship run;
4. creates an isolated temporary worker directory;
5. clones without GitHub credentials;
6. resolves the remote default branch to an exact commit;
7. checks out that commit in detached mode;
8. runs discovery, analysis, verification, and supported cost checks;
9. stores findings, evidence, logs, patches, and receipts;
10. deletes the complete temporary clone in a guaranteed cleanup step.

GitHub authorization is requested only for:

- private repositories;
- branch or draft pull-request creation;
- private GitHub and organization data;
- live write-permission checks;
- owner decisions tied to a GitHub identity.

Anonymous requests cannot replace an owner-connected repository.

## The repository oath

The software-oath.yml file declares promises a repository must preserve.

~~~yaml
version: 1

application:
  name: Acme Storefront
  repository: acme/storefront
  defaultBranch: main

approval:
  requireHumanFor: [critical]
  allowAutomaticMerge: false

cost:
  enabled: true
  requireEstimate: true
  currency: USD
  maxMonthlyIncrease: 50
  maxPercentageIncrease: 10

rules:
  - id: payments.no_duplicate_charge
    title: No duplicate charges
    description: A customer payment may be captured at most once per order.
    severity: critical
    repair:
      allowedPaths:
        - src/payments
        - tests/payments
      automaticCandidate: false
    evidence:
      - kind: test
        command: npm run test:checkout-regression
        required: true
        timeoutMs: 120000
~~~

Evidence commands belong to the repository and may use any toolchain, including npm, Cargo, Go, pytest, .NET, Maven, or custom scripts.

See the [complete example](examples/storefront/software-oath.yml) and [schema](schemas/software-oath.schema.json).

## Dashboard

The dashboard is a repository command center.

| View | Purpose |
| --- | --- |
| **Overview** | Attention summary, products, activity, readiness, and cost availability |
| **Connect** | Permission-free public scans or owner-authorized GitHub connection |
| **Incidents** | Patch scope, verification, cost evidence, receipts, and decisions |
| **Analytics** | Historical stewardship and verification trends |
| **Constitution** | Repository rules and evidence requirements |
| **Knowledge** | Persistent intelligence and owner-confirmed business context |
| **Questions** | Unresolved purpose, journey, and invariant questions |
| **Optimizer** | Dependency analysis, corrections, comparisons, and migrations |
| **Replays** | Historical reproduction and repair benchmarks |
| **Runs** | Durable progress, logs, results, and review state |
| **Settings** | Schedule, policy, retention, and data controls |

## Architecture

~~~mermaid
flowchart LR
    UI["Public site + dashboard + CLI"] --> API["Control plane API"]
    API --> DB["PostgreSQL / Neon"]
    API --> QUEUE["Durable run queue"]
    QUEUE --> WORKER["Worker orchestrator"]
    WORKER --> CLONE["Temporary isolated clone"]
    CLONE --> MEMORY["Inspection + repository memory"]
    MEMORY --> OPT["Dependency optimizer"]
    MEMORY --> REPAIR["Bounded repair"]
    REPAIR --> VERIFY["Scope + oath + findings + cost verification"]
    VERIFY --> RECEIPT["Signed receipt + artifacts"]
    RECEIPT --> REVIEW["Owner review"]
    REVIEW -->|authorized| PR["Draft GitHub pull request"]
    WORKER --> CLEANUP["Guaranteed workspace deletion"]
~~~

The control plane stores durable records and evidence. Source is processed in temporary runner workspaces and is not stored in Neon as a repository clone.

Production supports isolated Vercel Sandbox runners or a separately deployed trusted runner broker. See [Runner Security](docs/RUNNER_SECURITY.md) and [Architecture](docs/ARCHITECTURE.md).

## Quick start

Requirements:

- Node.js 20.19+ or 22.12+
- npm
- PostgreSQL for the connected control plane

~~~bash
git clone https://github.com/sariserhan/softwareoath.git
cd softwareoath
npm install
cp .env.example .env
npm run migrate
~~~

Run the services in separate terminals:

~~~bash
npm run dev
npm run serve
npm run worker
~~~

The dashboard normally opens at [http://localhost:5173](http://localhost:5173).

For production, see [Production Setup](docs/PRODUCTION_SETUP.md), [Deployment](docs/DEPLOYMENT.md), and [Release Operations](docs/RELEASE_OPERATIONS.md).

## CLI

| Command | Purpose |
| --- | --- |
| software-oath init | Discover validation commands and create a draft oath |
| software-oath inspect | Inspect deterministic repository findings |
| software-oath scan | Refresh persistent repository memory |
| software-oath check | Evaluate oath evidence and create a signed receipt |
| software-oath repair | Repair one finding in a disposable worktree |
| software-oath review | Review the patch and complete evidence |
| software-oath apply | Apply a verified patch to a new local branch |
| software-oath autopilot | Detect, repair, verify, and export |
| software-oath replay | Replay one historical incident |
| software-oath replay-suite | Benchmark historical incidents |
| software-oath serve | Start the control plane API |
| software-oath worker | Process durable background runs |
| software-oath migrate | Apply PostgreSQL migrations |
| software-oath export-attestations | Export a signed attestation bundle |
| software-oath verify-bundle | Verify a bundle signature and Merkle root |
| software-oath verify-attestation | Verify an owner-decision attestation |

Commands support machine-readable JSON output where applicable.

## Important API endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| /api/public/repositories/scan | POST | Queue a permission-free public GitHub scan |
| /api/public/runs/:id | GET | Return limited anonymous scan progress |
| /api/repositories | POST | Register an owner-authorized repository |
| /api/repositories/:repository/scan | POST | Start an owner-authorized scan |
| /api/runs | GET | Return durable run history |
| /api/runs/:id/review | GET | Return repair, evidence, patch, logs, and attestation |
| /api/runs/:id/decision | POST | Record an identified owner decision |
| /api/runs/:id/receipt | GET | Verify and return the final attestation |
| /api/replays | GET | Return historical replay reports |
| /webhooks/sentry | POST | Receive a signed Sentry incident |

## GitHub integration

The GitHub App is used for private access, permission checks, branch creation, draft pull requests, CI monitoring, and owner identity.

The reusable [GitHub Action](action.yml) uses split permissions:

1. a read-only job prepares a proposed patch;
2. Software Oath rejects out-of-scope edits and signs the receipt;
3. a separate write-capable job verifies the artifact;
4. only verified evidence can be delivered as a pull request.

Software Oath does not automatically merge pull requests.

## Development and verification

~~~bash
npm run lint
npm run test:run
npm run build
npm run oath:check
npm run runner:smoke
npm run sandbox:smoke
~~~

The project uses TypeScript, React, Vite, Vitest, PostgreSQL, durable queues, isolated runners, signed receipts, and pluggable artifact storage.

Additional documentation:

- [How It Works](docs/HOW_IT_WORKS.md)
- [Product Contract](docs/PRODUCT_CONTRACT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Optimizer Data Policy](docs/OPTIMIZER_DATA_POLICY.md)
- [Private Beta](docs/PRIVATE_BETA.md)
- [M6 Operations](docs/M6_OPERATIONS.md)

## Product boundaries

Software Oath is not:

- an automatic merge bot;
- an unrestricted repository-writing agent;
- a replacement for repository-owned tests;
- a guarantee that incomplete evidence is safe;
- a database for complete source repositories.

It is the evidence, policy, isolation, memory, and owner-control layer around repository maintenance.

## Security and privacy

Key properties include:

- least-privilege GitHub access;
- no credentials for public clone workflows;
- strict public GitHub URL validation;
- isolated temporary workspaces;
- detached commit checkout;
- bounded allowed paths;
- network-controlled verification;
- cryptographically signed receipts;
- no automatic merges;
- explicit human-review states;
- data deletion and retention controls.

Report security issues privately to the repository owner. Do not disclose exploitable vulnerabilities in a public issue.

## Status and license

Software Oath is running in production while active development continues. Some optimizer adapters and migration paths remain gated until their evidence criteria are complete. Unsupported coverage is reported explicitly rather than inferred.

This repository is proprietary unless a separate written license states otherwise.

# Software Oath

Software that keeps its promises.

Software Oath is an evidence and approval layer for AI-maintained applications. An
application declares the rules it must always preserve in `software-oath.yml`.
Repair runs attach evidence to those rules. Software Oath blocks failed repairs,
requires people to resolve judgment calls, and records why an accepted change was
considered safe.

## What works today

This repository contains a local MVP:

- A versioned `software-oath.yml` format.
- Strict parsing and validation of application rules.
- Deterministic evaluation of repair evidence.
- Decisions of `blocked`, `review_required`, or `ready`.
- A CLI that produces a machine-readable evidence report.
- A repository-local maintainer that executes declared checks and writes a receipt.
- An interactive React workspace that gates approval on unresolved human review.
- Unit and component tests covering parsing, evaluation, evidence tabs, and approval.

It now includes connected MVP primitives for signed Sentry ingestion, durable run
and approval records, GitHub App delivery, historical replay, bounded AI patches,
and local or Docker-backed trusted runners. Repair receipts are canonically signed
with Ed25519 and verified before review, application, delivery, or approval.
Human decisions produce a second signed attestation that chains the incident,
commits, pull request, repair receipt, verification proof, reviewer, and reason.
Automatic deployment remains outside
Software Oath.

## Run it

Requirements:

- Node.js 20.19+ or 22.12+
- npm

```bash
npm install
npm link
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

After `npm link`, run the product from any directory:

```bash
software-oath init /absolute/path/to/repository
software-oath inspect /absolute/path/to/repository
software-oath check /absolute/path/to/repository
software-oath autopilot /absolute/path/to/repository
software-oath replay /absolute/path/to/repository incident.yml
```

`init` discovers conservative repository-owned validation commands and writes a
draft `software-oath.yml`. It never enables automatic repair. Review the draft,
add business promises, and give each repairable rule a narrow path allowlist before
opting it into automation. Use `--dry-run` to preview the generated oath.

Run the maintainer against this repository:

```bash
npm run inspect
npm run maintain
npm run repair
npm run autopilot
```

`npm run inspect` examines tracked repository content for deterministic maintenance
signals. Each finding includes severity, evidence, an exact location, a repair
objective, and the paths the repair agent may change. Use
`npm run inspect -- --json` for machine-readable output. Critical and high findings
exit with status `1`.

The command reads [`software-oath.yml`](software-oath.yml), executes each declared
command from the repository root, evaluates the resulting evidence, and writes a
receipt under `.git/software-oath/runs/`. A failed required check exits with status `1`.
Use `npm run maintain -- --json` for machine-readable output or
`npm run maintain -- --no-receipt` to avoid writing a local receipt.

This local command executes repository-defined shell commands with the current
user's permissions. It is intended for repositories you trust. The future hosted
service must execute customer repositories in isolated ephemeral sandboxes.

`npm run repair` selects the highest-priority automatic finding, creates a detached
temporary Git worktree, and invokes the locally authenticated Codex CLI to prepare
one bounded repair. Software Oath rejects edits outside the finding's allowed paths,
runs every oath check against the modified worktree, and inspects the result again.
A repair is blocked unless the selected finding disappeared and no new critical or
high-severity finding appeared. It writes `repair.patch` and `receipt.json` under
`.git/software-oath/repairs/`, then deletes the worktree. It never commits, pushes,
merges, or modifies the original checkout.

To repair another local repository:

```bash
npm run inspect -- /absolute/path/to/repository
npm run maintain -- /absolute/path/to/repository
npm run repair -- /absolute/path/to/repository
```

If a finding is not marked as an automatic candidate, select it explicitly after
reviewing its evidence and repair boundary:

```bash
npm run repair -- /absolute/path/to/repository --finding <finding-id>
```

Requirements for AI repair:

- The target is a Git repository with a committed `software-oath.yml`.
- The target's oath commands work from a clean checkout.
- The `codex` CLI is installed and authenticated.

`npm run autopilot -- /path/to/repository` performs the complete local loop. It
runs the application's oath checks, inspects tracked content, selects the first
explicitly authorized automatic candidate, attempts one isolated repair, verifies
the result, and exports the patch. It stops after one repair so every change has a
separate evidence trail.

## Historical incident replay

`software-oath replay <repository> <incident.yml>` checks out the declared buggy
commit in a disposable worktree, confirms its selected finding, runs the bounded
repair, and compares the resulting patch with the original human fix. It stores a
benchmark under `.git/software-oath/replays/`.

`software-oath replay-suite <suite.yml> [repository]` runs multiple historical
incidents and saves an aggregate benchmark under
`.git/software-oath/replay-suites/`. A replay can derive its immutable regression
evidence directly from the original human-fix commit.

The historical commit must contain its committed regression test and
`software-oath.yml`. Pass `--docker-image <trusted-image>` to execute oath commands
inside an ephemeral container with no network, dropped capabilities, resource
limits, and `no-new-privileges`.

Review and apply an exported repair:

```bash
software-oath review /path/to/repository latest
software-oath apply /path/to/repository latest
```

`review` renders the problem, scope, evidence, before-and-after finding counts,
whether the original problem was resolved, any new blocking findings, and the
complete patch. `apply` verifies that proof plus the receipt and patch digest,
requires the exact base commit and a clean checkout, creates a
`software-oath/<repair-id>` branch, applies the patch, and executes the oath again.
It leaves the files uncommitted for final human inspection. A `review_required`
receipt additionally needs `--approve-review`.

## GitHub Action

The reusable action in [`action.yml`](action.yml) follows a split-permission model:

1. A read-only job runs inspection and the official `openai/codex-action`.
2. Software Oath rejects out-of-scope edits and uploads the patch and receipt.
3. A separate job with repository write permission downloads only that artifact,
   applies and reverifies it, then opens a pull request.

Copy [`docs/software-oath-workflow.yml`](docs/software-oath-workflow.yml) into the
customer repository as `.github/workflows/software-oath.yml`, add an
`OPENAI_API_KEY` repository secret, and replace `@v1` only if using another pinned
Software Oath release. The action does not automatically merge repairs.

## Connected control plane

Copy `.env.example`, set a long random approval token and the Sentry Integration
client secret, then run `npm run serve` beside `npm run dev`.

- `POST /webhooks/sentry` authenticates and deduplicates Sentry incidents.
- `GET /api/runs` returns durable run history.
- `POST /api/runs/:id/decision` records an identified decision and written reason.

The Runs workspace reads these endpoints and keeps the approval token only in
component memory. `GitHubAppClient` exchanges a short-lived App JWT for an
installation token, dispatches the repair workflow, and opens draft pull requests
from verified repair branches. Configure Contents write, Pull requests write, and
Metadata read permissions. Software Oath never merges the pull request.

`software-oath worker` claims new incidents, maps the Sentry project to GitHub,
checks out the release commit, repairs and verifies it, saves the receipt, pushes
a repair branch, and opens a draft PR. PostgreSQL provides exclusive leases,
retry state, cancellation, and durable lifecycle logs.

```bash
npm run migrate
npm run worker
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Docker Compose, encrypted GitHub
App onboarding, Sentry mapping, and production hosting requirements.

Run the local constitution evaluator:

```bash
npm run oath:check
```

Validate the repository:

```bash
npm run lint
npm run test:run
npm run build
```

## Constitution example

```yaml
version: 1

application:
  name: Acme Storefront
  repository: acme/storefront
  defaultBranch: main

approval:
  requireHumanFor: [critical]
  allowAutomaticMerge: false

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
```

The command can be any toolchain the application requires: `cargo test`,
`go test ./...`, `pytest`, `dotnet test`, `mvn test`, `xcodebuild test`, a
container command, or a repository-owned script. Software Oath does not infer
that one operating system or language can prove another application's behavior.
Failed oath commands become findings. They are eligible for automatic repair only
when the rule explicitly supplies a non-empty path allowlist and opts in with
`automaticCandidate: true`.

The complete example is at
[`examples/storefront/software-oath.yml`](examples/storefront/software-oath.yml).
The machine-readable schema is
[`schemas/software-oath.schema.json`](schemas/software-oath.schema.json).

## Product boundary

Software Oath is not another coding assistant. Coding agents may propose a repair,
but Software Oath owns the acceptance decision:

```text
Incident → Reproduction → Proposed repair → Oath evaluation
                                               ↓
                         Block / Human review / Ready
```

See [`docs/MVP.md`](docs/MVP.md) for the first connected product milestone and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the target system.

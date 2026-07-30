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

It does **not** yet connect to GitHub, ingest production incidents, generate patches,
execute untrusted repositories, deploy changes, or call an AI model.

## Run it

Requirements:

- Node.js 20.19+ or 22.12+
- npm

```bash
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

Run the maintainer against this repository:

```bash
npm run maintain
```

The command reads [`software-oath.yml`](software-oath.yml), executes each declared
command from the repository root, evaluates the resulting evidence, and writes a
receipt under `.softwareoath/runs/`. A failed required check exits with status `1`.
Use `npm run maintain -- --json` for machine-readable output or
`npm run maintain -- --no-receipt` to avoid writing a local receipt.

This local command executes repository-defined shell commands with the current
user's permissions. It is intended for repositories you trust. The future hosted
service must execute customer repositories in isolated ephemeral sandboxes.

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
    evidence:
      - kind: test
        command: npm run test:checkout-regression
        required: true
        timeoutMs: 120000
```

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

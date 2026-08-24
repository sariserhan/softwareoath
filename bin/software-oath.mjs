#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const [command, ...args] = process.argv.slice(2);
const commands = new Map([
  ["init", "scripts/init.ts"],
  ["inspect", "scripts/inspect.ts"],
  ["scan", "scripts/scan.ts"],
  ["check", "scripts/maintain.ts"],
  ["repair", "scripts/repair.ts"],
  ["review", "scripts/review.ts"],
  ["apply", "scripts/apply.ts"],
  ["autopilot", "scripts/autopilot.ts"],
  ["replay", "scripts/replay.ts"],
  ["serve", "scripts/serve.ts"],
  ["github-manifest", "scripts/github-manifest.ts"],
  ["migrate", "scripts/migrate.ts"],
  ["worker", "scripts/worker.ts"],
  ["github-convert", "scripts/github-convert.ts"],
  ["replay-suite", "scripts/replay-suite.ts"],
  ["export-attestations", "scripts/export-attestations.ts"],
  ["verify-bundle", "scripts/verify-bundle.ts"],
  ["verify-attestation", "scripts/verify-attestation.ts"],
]);

if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(`Software Oath

Usage:
  software-oath init [repository] [--dry-run] [--force]
  software-oath inspect [repository] [--json]
  software-oath scan [repository] [--memory <path>] [--json]
  software-oath check [repository] [--json] [--no-receipt]
  software-oath repair [repository] [--finding <id>] [--json]
  software-oath review [repository] [repair-id] [--receipt <path>]
  software-oath apply [repository] [repair-id] [--branch <name>]
  software-oath autopilot [repository] [--json]
  software-oath replay <repository> <incident.yml> [--docker-image <image>] [--json]
  software-oath serve
  software-oath github-manifest <https://your-domain>
  software-oath migrate
  software-oath worker
  software-oath github-convert <manifest-code>
  software-oath replay-suite <suite.yml> [repository]
  software-oath export-attestations [repository] [--output <path>]
  software-oath verify-bundle <attestation-bundle.json>
  software-oath verify-attestation <final-attestation.json>

Commands:
  init       Discover validation commands and create software-oath.yml
  inspect    Find deterministic problems and run oath checks
  scan       Refresh the repository's persistent stewardship memory
  check      Execute declared evidence and write a receipt
  repair     Repair one selected problem in a disposable worktree
  review     Show a repair's evidence and complete patch
  apply      Apply a verified patch to a new uncommitted branch
  autopilot  Detect, select, repair, verify, and export one patch
  replay     Reproduce and benchmark a historical incident repair
  serve      Start the stewardship, repository, and approval API
  github-manifest  Print the least-privilege GitHub App manifest
  migrate    Apply pending PostgreSQL migrations
  worker     Process durable repair jobs
  github-convert  Encrypt a GitHub App manifest conversion
  replay-suite  Benchmark multiple historical incidents
  export-attestations  Export cryptographic evidence & attestation bundle
  verify-bundle  Verify cryptographic Merkle root & signature of an attestation bundle
  verify-attestation  Verify a final owner-decision attestation signature
`);
  process.exit(0);
}

const script = commands.get(command);
if (!script) {
  process.stderr.write(`Unknown command: ${command}\nRun software-oath help.\n`);
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoader, resolve(root, script), ...args],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(2);
}

process.exit(result.status ?? 2);

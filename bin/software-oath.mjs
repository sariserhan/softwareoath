#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);
const commands = new Map([
  ["init", "scripts/init.ts"],
  ["inspect", "scripts/inspect.ts"],
  ["check", "scripts/maintain.ts"],
  ["repair", "scripts/repair.ts"],
  ["review", "scripts/review.ts"],
  ["apply", "scripts/apply.ts"],
  ["autopilot", "scripts/autopilot.ts"],
]);

if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(`Software Oath

Usage:
  software-oath init [repository] [--dry-run] [--force]
  software-oath inspect [repository] [--json]
  software-oath check [repository] [--json] [--no-receipt]
  software-oath repair [repository] [--finding <id>] [--json]
  software-oath review [repository] [repair-id] [--receipt <path>]
  software-oath apply [repository] [repair-id] [--branch <name>]
  software-oath autopilot [repository] [--json]

Commands:
  init       Discover validation commands and create software-oath.yml
  inspect    Find deterministic problems and run oath checks
  check      Execute declared evidence and write a receipt
  repair     Repair one selected problem in a disposable worktree
  review     Show a repair's evidence and complete patch
  apply      Apply a verified patch to a new uncommitted branch
  autopilot  Detect, select, repair, verify, and export one patch
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
  ["--import", "tsx", resolve(root, script), ...args],
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

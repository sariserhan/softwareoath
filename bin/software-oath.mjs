#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);
const commands = new Map([
  ["inspect", "scripts/inspect.ts"],
  ["check", "scripts/maintain.ts"],
  ["repair", "scripts/repair.ts"],
  ["autopilot", "scripts/autopilot.ts"],
]);

if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(`Software Oath

Usage:
  software-oath inspect [repository] [--json]
  software-oath check [repository] [--json] [--no-receipt]
  software-oath repair [repository] [--finding <id>] [--json]
  software-oath autopilot [repository] [--json]

Commands:
  inspect    Find deterministic problems and run oath checks
  check      Execute declared evidence and write a receipt
  repair     Repair one selected problem in a disposable worktree
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

import process from "node:process";

import { initializeRepository } from "../src/onboarding/init";

const args = process.argv.slice(2);
const repositoryPath = args.find((argument) => !argument.startsWith("--")) ?? ".";

try {
  const result = await initializeRepository({
    repositoryPath,
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
  });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${result.created ? "Created" : "Previewed"} ${result.oathPath}\n`,
    );
    process.stdout.write(
      `Discovered ${result.discoveredChecks.length} executable check(s).\n`,
    );
    for (const check of result.discoveredChecks) {
      process.stdout.write(`  ${check.id}: ${check.command}\n`);
    }
    for (const warning of result.warnings) {
      process.stdout.write(`Warning: ${warning}\n`);
    }
    if (!result.created) process.stdout.write(`\n${result.source}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

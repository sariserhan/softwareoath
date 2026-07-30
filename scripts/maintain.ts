import process from "node:process";

import {
  formatMaintenanceSummary,
  runMaintenance,
} from "../src/maintainer/run";

const args = process.argv.slice(2);
const json = args.includes("--json");
const noReceipt = args.includes("--no-receipt");
const repositoryPath = args.find((argument) => !argument.startsWith("--")) ?? ".";

try {
  const receipt = await runMaintenance({
    repositoryPath,
    writeReceipt: !noReceipt,
  });
  process.stdout.write(
    json
      ? `${JSON.stringify(receipt, null, 2)}\n`
      : formatMaintenanceSummary(receipt),
  );
  if (receipt.report.decision === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

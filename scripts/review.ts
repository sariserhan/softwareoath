import process from "node:process";

import {
  formatRepairReview,
  resolveRepairReceipt,
} from "../src/repair/receipt";

const args = process.argv.slice(2);
const receiptIndex = args.indexOf("--receipt");
const receiptPath = receiptIndex >= 0 ? args.at(receiptIndex + 1) : undefined;
const positional = args.filter(
  (argument, index) =>
    !argument.startsWith("--") &&
    (receiptIndex < 0 || index !== receiptIndex + 1),
);
const repositoryPath = positional[0] ?? ".";
const repairId = positional[1] ?? "latest";

try {
  if (args.includes("--json")) {
    const resolved = await resolveRepairReceipt({
      repositoryPath,
      repairId,
      receiptPath,
    });
    process.stdout.write(`${JSON.stringify(resolved.receipt, null, 2)}\n`);
  } else {
    process.stdout.write(
      await formatRepairReview({ repositoryPath, repairId, receiptPath }),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

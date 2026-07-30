import process from "node:process";

import {
  applyRepair,
  formatApplicationResult,
} from "../src/repair/receipt";

const args = process.argv.slice(2);
const receiptIndex = args.indexOf("--receipt");
const branchIndex = args.indexOf("--branch");
const receiptPath = receiptIndex >= 0 ? args.at(receiptIndex + 1) : undefined;
const branch = branchIndex >= 0 ? args.at(branchIndex + 1) : undefined;
const valueIndexes = new Set(
  [receiptIndex, branchIndex].filter((index) => index >= 0).map((index) => index + 1),
);
const positional = args.filter(
  (argument, index) => !argument.startsWith("--") && !valueIndexes.has(index),
);
const repositoryPath = positional[0] ?? ".";
const repairId = positional[1] ?? "latest";

try {
  const application = await applyRepair({
    repositoryPath,
    repairId,
    receiptPath,
    branch,
    approveReview: args.includes("--approve-review"),
  });
  process.stdout.write(
    args.includes("--json")
      ? `${JSON.stringify(application, null, 2)}\n`
      : formatApplicationResult(application),
  );
  if (application.decision === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

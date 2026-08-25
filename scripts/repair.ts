import process from "node:process";

import { CodexRepairAgent } from "../src/repair/codex.js";
import { repairAgentFromEnvironment } from "../src/repair/providers.js";
import { formatRepairReceipt, runRepair } from "../src/repair/run.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const findingIndex = args.indexOf("--finding");
const findingId =
  findingIndex >= 0 ? args.at(findingIndex + 1) : undefined;
const positional = args.filter(
  (argument, index) =>
    !argument.startsWith("--") &&
    (findingIndex < 0 || index !== findingIndex + 1),
);
const repositoryPath = positional[0] ?? ".";

try {
  const receipt = await runRepair({
    repositoryPath,
    findingId,
    agent: repairAgentFromEnvironment() ?? new CodexRepairAgent(),
  });
  process.stdout.write(
    json ? `${JSON.stringify(receipt, null, 2)}\n` : formatRepairReceipt(receipt),
  );
  if (receipt.decision === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

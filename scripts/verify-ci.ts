import { appendFile } from "node:fs/promises";
import process from "node:process";

import { verifyExternalRepair } from "../src/repair/external";

const args = process.argv.slice(2);
function value(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args.at(index + 1) : undefined;
}
const contextPath = value("--context");
const outputDirectory = value("--output-dir");
const agentOutputPath = value("--agent-output");
const consumed = new Set(
  ["--context", "--output-dir", "--agent-output"]
    .map((name) => args.indexOf(name))
    .filter((index) => index >= 0)
    .map((index) => index + 1),
);
const repositoryPath =
  args.find(
    (argument, index) =>
      !argument.startsWith("--") && !consumed.has(index),
  ) ?? ".";

if (!contextPath || !outputDirectory) {
  console.error("--context and --output-dir are required");
  process.exit(2);
}

try {
  const receipt = await verifyExternalRepair({
    repositoryPath,
    contextPath,
    outputDirectory,
    agentOutputPath,
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `decision=${receipt.decision}\nrepair-id=${receipt.id}\nartifact-dir=${outputDirectory}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.decision === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

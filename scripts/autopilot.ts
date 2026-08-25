import process from "node:process";

import { formatInspectionReport, inspectRepository } from "../src/detector/inspect.js";
import { CodexRepairAgent } from "../src/repair/codex.js";
import { formatRepairReceipt, runRepair } from "../src/repair/run.js";

const args = process.argv.slice(2);
const repositoryPath = args.find((argument) => !argument.startsWith("--")) ?? ".";
const json = args.includes("--json");

try {
  const inspection = await inspectRepository({ repositoryPath });
  const candidate = inspection.findings.find(
    ({ repair }) => repair.automaticCandidate,
  );

  if (!candidate) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ status: "no_automatic_repair", inspection }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(formatInspectionReport(inspection));
      process.stdout.write(
        inspection.summary.total === 0
          ? "Application is healthy. No repair was needed.\n"
          : "Findings require human selection or broader repair boundaries.\n",
      );
    }
  } else {
    const receipt = await runRepair({
      repositoryPath,
      findingId: candidate.id,
      agent: new CodexRepairAgent(),
    });
    process.stdout.write(
      json
        ? `${JSON.stringify({ status: receipt.decision, inspection, receipt }, null, 2)}\n`
        : `${formatInspectionReport(inspection)}\n${formatRepairReceipt(receipt)}`,
    );
    if (receipt.decision === "blocked") process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

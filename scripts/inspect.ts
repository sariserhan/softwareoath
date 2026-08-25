import process from "node:process";

import {
  formatInspectionReport,
  inspectRepository,
} from "../src/detector/inspect.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const repositoryPath = args.find((argument) => !argument.startsWith("--")) ?? ".";

try {
  const report = await inspectRepository({
    repositoryPath,
    includeDependencyChecks: true,
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : formatInspectionReport(report),
  );
  if (report.summary.critical > 0 || report.summary.high > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

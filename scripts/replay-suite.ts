import process from "node:process";

import { runReplaySuite } from "../src/replay/suite";

const suitePath = process.argv[2];
const repositoryPath = process.argv[3];
if (!suitePath) {
  console.error("Usage: software-oath replay-suite <suite.yml> [repository]");
  process.exit(2);
}

const report = await runReplaySuite({ suitePath, repositoryPath });
process.stdout.write(
  `Software Oath replay suite · ${report.name}\nPassed: ${report.passed}\nFailed: ${report.failed}\n`,
);
for (const incident of report.incidents) {
  process.stdout.write(
    `[${incident.status}] ${incident.spec}${
      incident.status === "failed" ? ` — ${incident.error}` : ""
    }\n`,
  );
}
if (report.failed) process.exitCode = 1;

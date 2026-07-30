import { readFile } from "node:fs/promises";
import process from "node:process";

import { evaluateOath, parseOath } from "../src/domain/oath";
import type { RepairRun } from "../src/domain/types";

const [, , oathPath, runPath] = process.argv;

if (!oathPath || !runPath) {
  console.error("Usage: npm run oath:check -- <software-oath.yml> <repair-run.json>");
  process.exit(2);
}

try {
  const [oathSource, runSource] = await Promise.all([
    readFile(oathPath, "utf8"),
    readFile(runPath, "utf8"),
  ]);
  const report = evaluateOath(
    parseOath(oathSource),
    JSON.parse(runSource) as RepairRun,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.decision === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

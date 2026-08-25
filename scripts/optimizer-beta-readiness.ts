import { readFile } from "node:fs/promises";
import process from "node:process";

import { evaluateOptimizerBetaReadiness } from "../src/optimizer/beta-readiness.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run optimizer:beta-readiness -- <evidence.json>");
  process.exit(2);
}
const evidence = JSON.parse(await readFile(path, "utf8")) as unknown;
const report = evaluateOptimizerBetaReadiness(evidence);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!report.ready) process.exitCode = 1;

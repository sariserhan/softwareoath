import { readFile } from "node:fs/promises";
import process from "node:process";
import { evaluateM7Readiness } from "../src/control-plane/m7-readiness.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run m7:readiness -- <evidence.json>");
  process.exit(2);
}
const report = evaluateM7Readiness(JSON.parse(await readFile(path, "utf8")));
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!report.ready) process.exitCode = 1;

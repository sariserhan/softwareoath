import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "yaml";

import type { RepairAgent } from "../repair/types";
import { runReplay } from "./run";
import type { ReplayReport } from "./types";

export interface ReplaySuiteReport {
  version: 1;
  name: string;
  generatedAt: string;
  repositoryPath: string;
  passed: number;
  failed: number;
  incidents: Array<
    | { spec: string; status: "passed"; report: ReplayReport }
    | { spec: string; status: "failed"; error: string }
  >;
}

export async function runReplaySuite(options: {
  suitePath: string;
  repositoryPath?: string;
  agent?: RepairAgent;
}): Promise<ReplaySuiteReport> {
  const suitePath = resolve(options.suitePath);
  const raw = parse(await readFile(suitePath, "utf8")) as {
    version?: unknown;
    name?: unknown;
    repositoryPath?: unknown;
    incidents?: unknown;
  };
  if (
    raw.version !== 1 ||
    typeof raw.name !== "string" ||
    !Array.isArray(raw.incidents)
  ) {
    throw new Error("Replay suite must declare version, name, and incidents.");
  }
  const repositoryPath = resolve(
    options.repositoryPath ??
      (typeof raw.repositoryPath === "string" ? raw.repositoryPath : "."),
  );
  const incidents: ReplaySuiteReport["incidents"] = [];
  for (const entry of raw.incidents) {
    if (typeof entry !== "string") {
      throw new Error("Replay suite incident paths must be strings.");
    }
    const spec = resolve(dirname(suitePath), entry);
    try {
      incidents.push({
        spec,
        status: "passed",
        report: await runReplay({
          repositoryPath,
          specPath: spec,
          agent: options.agent,
        }),
      });
    } catch (error) {
      incidents.push({
        spec,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown replay error",
      });
    }
  }
  const report: ReplaySuiteReport = {
    version: 1,
    name: raw.name,
    generatedAt: new Date().toISOString(),
    repositoryPath,
    passed: incidents.filter(({ status }) => status === "passed").length,
    failed: incidents.filter(({ status }) => status === "failed").length,
    incidents,
  };
  const outputDirectory = join(
    repositoryPath,
    ".git",
    "software-oath",
    "replay-suites",
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, `${basename(suitePath, ".yml")}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

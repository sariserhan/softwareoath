import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { ReplayReport } from "./types.js";

export interface ReplaySuiteTestCase {
  id: string;
  name: string;
  repository: string;
  incidentFile: string;
  dockerImage?: string;
  expectedDecision?: "blocked" | "review_required" | "ready";
}

export interface ReplaySuiteDefinition {
  version: 1;
  name: string;
  description?: string;
  cases: ReplaySuiteTestCase[];
}

export interface ReplaySuiteCaseResult {
  testCase: ReplaySuiteTestCase;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  result?: ReplayReport;
  error?: string;
}

export interface ReplaySuiteReport {
  suiteName: string;
  executedAt: string;
  durationMs: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
  };
  cases: ReplaySuiteCaseResult[];
}

export function parseReplaySuite(content: string): ReplaySuiteDefinition {
  const parsed = parse(content) as ReplaySuiteDefinition;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cases)) {
    throw new Error("Invalid replay suite format. Must include version: 1 and a cases array.");
  }
  return parsed;
}

export async function loadReplaySuite(path: string): Promise<ReplaySuiteDefinition> {
  const content = await readFile(path, "utf8");
  return parseReplaySuite(content);
}

export async function runReplaySuite(
  suite: ReplaySuiteDefinition,
  runner: (testCase: ReplaySuiteTestCase) => Promise<ReplayReport>,
): Promise<ReplaySuiteReport> {
  const startedAt = Date.now();
  const caseResults: ReplaySuiteCaseResult[] = [];

  for (const testCase of suite.cases) {
    const caseStart = Date.now();
    try {
      const result = await runner(testCase);
      const passed =
        result.verdict === "passed" &&
        (!testCase.expectedDecision || result.repair?.decision === testCase.expectedDecision);

      caseResults.push({
        testCase,
        status: passed ? "passed" : "failed",
        durationMs: Date.now() - caseStart,
        result,
      });
    } catch (err) {
      caseResults.push({
        testCase,
        status: "failed",
        durationMs: Date.now() - caseStart,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  const passedCount = caseResults.filter((c) => c.status === "passed").length;
  const failedCount = caseResults.filter((c) => c.status === "failed").length;
  const skippedCount = caseResults.filter((c) => c.status === "skipped").length;
  const total = caseResults.length;

  return {
    suiteName: suite.name,
    executedAt: new Date().toISOString(),
    durationMs,
    summary: {
      total,
      passed: passedCount,
      failed: failedCount,
      skipped: skippedCount,
      passRate: total > 0 ? (passedCount / total) * 100 : 0,
    },
    cases: caseResults,
  };
}

import { describe, expect, it, vi } from "vitest";
import { parseReplaySuite, runReplaySuite, type ReplaySuiteDefinition } from "./suite.js";
import type { ReplayReport } from "./types.js";

describe("replay suite benchmark engine", () => {
  it("parses valid replay suite YAML definition", () => {
    const yaml = `
version: 1
name: Benchmark Suite
cases:
  - id: CASE-1
    name: Storefront incident
    repository: acme/storefront
    incidentFile: examples/storefront/incident.yml
    expectedDecision: ready
`;
    const suite = parseReplaySuite(yaml);
    expect(suite.name).toBe("Benchmark Suite");
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0].id).toBe("CASE-1");
  });

  it("runs replay suite and calculates pass rate metrics", async () => {
    const suite: ReplaySuiteDefinition = {
      version: 1,
      name: "Regression Benchmark",
      cases: [
        {
          id: "CASE-1",
          name: "Payment timeout",
          repository: "acme/storefront",
          incidentFile: "incident1.yml",
          expectedDecision: "ready",
        },
        {
          id: "CASE-2",
          name: "Order corruption",
          repository: "acme/storefront",
          incidentFile: "incident2.yml",
          expectedDecision: "ready",
        },
      ],
    };

    const mockRunner = vi.fn().mockImplementation(async (testCase): Promise<ReplayReport> => {
      if (testCase.id === "CASE-1") {
        return {
          version: 1,
          id: "CASE-1",
          title: "Payment timeout",
          repositoryPath: ".",
          baseCommit: "a1b2c3d",
          humanFixCommit: "e5f6g7h",
          startedAt: "2026-07-30T12:00:00Z",
          completedAt: "2026-07-30T12:00:05Z",
          durationMs: 5000,
          reproductionConfirmed: true,
          repair: { decision: "ready" } as ReplayReport["repair"],
          comparison: { exactPatchMatch: true } as ReplayReport["comparison"],
          verdict: "passed",
        };
      }
      return {
        version: 1,
        id: "CASE-2",
        title: "Order corruption",
        repositoryPath: ".",
        baseCommit: "a1b2c3d",
        humanFixCommit: "e5f6g7h",
        startedAt: "2026-07-30T12:00:00Z",
        completedAt: "2026-07-30T12:00:05Z",
        durationMs: 5000,
        reproductionConfirmed: true,
        repair: { decision: "blocked" } as ReplayReport["repair"],
        comparison: { exactPatchMatch: false } as ReplayReport["comparison"],
        verdict: "failed",
      };
    });

    const report = await runReplaySuite(suite, mockRunner);

    expect(report.suiteName).toBe("Regression Benchmark");
    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.passRate).toBe(50);
    expect(report.cases[0].status).toBe("passed");
    expect(report.cases[1].status).toBe("failed");
  });
});

import { describe, expect, it } from "vitest";

import { evaluateOath, parseOath } from "./oath";
import type { RepairRun } from "./types";

const source = `
version: 1
application:
  name: Example
  repository: example/app
  defaultBranch: main
approval:
  requireHumanFor: [critical]
  allowAutomaticMerge: false
rules:
  - id: payments.once
    title: No duplicate charges
    description: A payment is captured at most once.
    severity: critical
    evidence:
      - kind: test
        path: tests/payment.test.ts
        required: true
`;

const run: RepairRun = {
  id: "RUN-1",
  incident: {
    title: "Payment failure",
    source: "test",
    detectedAt: "2026-07-30T00:00:00Z",
  },
  repository: { branch: "main", commit: "abc1234" },
  repair: { summary: "Fix payment", files: [], diff: [] },
  evidence: [
    {
      ruleId: "payments.once",
      kind: "test",
      status: "passed",
      summary: "Regression test passed.",
    },
  ],
};

describe("parseOath", () => {
  it("rejects any policy that allows Software Oath to merge", () => {
    expect(() =>
      parseOath(
        source.replace(
          "allowAutomaticMerge: false",
          "allowAutomaticMerge: true",
        ),
      ),
    ).toThrow("never merges pull requests");
  });

  it("parses a valid oath", () => {
    expect(parseOath(source).rules[0].id).toBe("payments.once");
  });

  it("rejects duplicate rule ids", () => {
    expect(() =>
      parseOath(`${source}
  - id: payments.once
    title: Duplicate
    description: Duplicate id.
    severity: low
    evidence:
      - kind: review
        required: true
`),
    ).toThrow("rule ids must be unique");
  });
});

describe("evaluateOath", () => {
  it("requires review for passed critical rules", () => {
    const report = evaluateOath(parseOath(source), run, "2026-07-30T01:00:00Z");
    expect(report.decision).toBe("review_required");
    expect(report.summary.passed).toBe(1);
  });

  it("blocks failed evidence", () => {
    const failed: RepairRun = {
      ...run,
      evidence: [{ ...run.evidence[0], status: "failed" }],
    };
    expect(evaluateOath(parseOath(source), failed).decision).toBe("blocked");
  });

  it("requests review when evidence is missing", () => {
    expect(
      evaluateOath(parseOath(source), { ...run, evidence: [] }).rules[0].reason,
    ).toContain("Missing required evidence");
  });
});

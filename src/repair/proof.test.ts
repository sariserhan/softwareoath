import { describe, expect, it } from "vitest";

import type {
  InspectionReport,
  RepositoryFinding,
} from "../detector/types.js";
import { compareRepairProof, repairDecision } from "./proof.js";

function finding(
  id: string,
  severity: RepositoryFinding["severity"] = "high",
): RepositoryFinding {
  return {
    id,
    detector: "fixture",
    category: "maintainability",
    severity,
    title: id,
    summary: id,
    evidence: { detail: id },
    repair: {
      objective: `Resolve ${id}`,
      allowedPaths: ["src"],
      automaticCandidate: true,
    },
  };
}

function report(findings: RepositoryFinding[]): InspectionReport {
  return {
    version: 1,
    repositoryPath: "/fixture",
    generatedAt: "2026-07-30T00:00:00Z",
    summary: {
      total: findings.length,
      critical: findings.filter(({ severity }) => severity === "critical").length,
      high: findings.filter(({ severity }) => severity === "high").length,
      medium: findings.filter(({ severity }) => severity === "medium").length,
      low: findings.filter(({ severity }) => severity === "low").length,
      automaticCandidates: findings.filter(
        ({ repair }) => repair.automaticCandidate,
      ).length,
    },
    findings,
  };
}

describe("repair proof", () => {
  it("proves the selected finding disappeared", () => {
    const selected = finding("selected");
    const proof = compareRepairProof(report([selected]), report([]), selected);

    expect(proof.selectedFindingResolved).toBe(true);
    expect(
      repairDecision({
        withinAllowedScope: true,
        hasPatch: true,
        verificationDecision: "ready",
        proof,
      }),
    ).toBe("ready");
  });

  it("blocks a patch that leaves the selected finding unresolved", () => {
    const selected = finding("selected");
    const proof = compareRepairProof(
      report([selected]),
      report([selected]),
      selected,
    );

    expect(proof.selectedFindingResolved).toBe(false);
    expect(
      repairDecision({
        withinAllowedScope: true,
        hasPatch: true,
        verificationDecision: "ready",
        proof,
      }),
    ).toBe("blocked");
  });

  it("blocks a repair that introduces a new high-severity finding", () => {
    const selected = finding("selected");
    const regression = finding("regression", "critical");
    const proof = compareRepairProof(
      report([selected]),
      report([regression]),
      selected,
    );

    expect(proof.blockingNewFindings).toEqual([regression]);
    expect(
      repairDecision({
        withinAllowedScope: true,
        hasPatch: true,
        verificationDecision: "ready",
        proof,
      }),
    ).toBe("blocked");
  });

  it("blocks a repair that escalates an existing finding to high severity", () => {
    const selected = finding("selected");
    const existing = finding("existing", "low");
    const escalated = finding("existing", "high");
    const proof = compareRepairProof(
      report([selected, existing]),
      report([escalated]),
      selected,
    );

    expect(proof.newFindings).toHaveLength(0);
    expect(proof.blockingNewFindings).toEqual([escalated]);
    expect(
      repairDecision({
        withinAllowedScope: true,
        hasPatch: true,
        verificationDecision: "ready",
        proof,
      }),
    ).toBe("blocked");
  });
});

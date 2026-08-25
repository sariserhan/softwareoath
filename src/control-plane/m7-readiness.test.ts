import { describe, expect, it } from "vitest";
import { evaluateM7Readiness } from "./m7-readiness.js";

const repository = (digit: string) => ({
  repositorySha256: digit.repeat(64), ownerEngaged: true,
  completedJourneyWithoutIntervention: digit === "a",
});

describe("M7 readiness", () => {
  it("passes complete, privacy-preserving beta evidence", () => {
    const report = evaluateM7Readiness({
      version: 1, generatedAt: "2026-08-25T00:00:00Z",
      supportedMatrixPublished: true, betaTermsPublished: true,
      disconnectAndDeletionVerified: true, instrumentationVerified: true,
      historicalReplays: 5, historicalReproductions: 5,
      repositories: [repository("a"), repository("b"), repository("c")],
      repairs: ["a", "b"].map((digit, index) => ({
        id: `repair-${index}`, repositorySha256: digit.repeat(64),
        reproductionConfirmed: true, selectedFindingFalsePositive: false,
        patchRejected: false, requiredEvidencePassed: true, ciPassed: true,
        ownerDecision: "accepted", maintainableByEngineer: true, reviewDurationMinutes: 12,
      })),
    });
    expect(report.ready).toBe(true);
  });

  it("blocks missing partners, acceptance, and evidence violations", () => {
    const report = evaluateM7Readiness({
      version: 1, generatedAt: "2026-08-25T00:00:00Z",
      supportedMatrixPublished: true, betaTermsPublished: true,
      disconnectAndDeletionVerified: true, instrumentationVerified: true,
      historicalReplays: 5, historicalReproductions: 3,
      repositories: [repository("a")],
      repairs: [{ id: "unsafe", repositorySha256: "a".repeat(64),
        reproductionConfirmed: true, selectedFindingFalsePositive: false,
        patchRejected: true, requiredEvidencePassed: false, ciPassed: false,
        ownerDecision: "rejected" }],
    });
    expect(report.ready).toBe(false);
    expect(report.checks.filter(({ passed }) => !passed).map(({ id }) => id))
      .toEqual(expect.arrayContaining(["beta.repositories", "beta.accepted_repairs", "beta.evidence_safety"]));
  });
});

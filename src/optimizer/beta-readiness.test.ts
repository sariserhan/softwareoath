import { describe, expect, it } from "vitest";

import { evaluateOptimizerBetaReadiness } from "./beta-readiness.js";

function review(index: number) {
  return {
    id: `REVIEW-${index}`,
    analysisId: `ANALYSIS-${index}`,
    repositorySha256: index.toString(16).padStart(64, "0"),
    outcome: "completed",
    recommendation: index <= 3 ? "replace" : "keep",
    unknownCount: 0,
    consequentialCapabilityCorrection: index === 5,
    migrationSpecificationGenerated: index <= 3,
    migrationSpecificationReviewed: index <= 3,
    migrationSpecificationReview: index <= 3 ? {
      reviewer: "reviewer", reviewedAt: "2026-08-25T00:00:00Z",
    } : undefined,
    ownerOutcome: index <= 3 ? "accepted" : "pending",
    engineerReview: index <= 3 ? {
      reviewer: "engineer", reviewedAt: "2026-08-25T00:00:00Z", verdict: "actionable",
    } : undefined,
  };
}

describe("optimizer O8 beta readiness", () => {
  it("computes metrics and passes the complete exit gate", () => {
    const report = evaluateOptimizerBetaReadiness({
      version: 1,
      generatedAt: "2026-08-25T00:00:00Z",
      tenantIsolationVerified: true,
      sourceDeletionVerified: true,
      reviews: [1, 2, 3, 4, 5].map(review),
    });
    expect(report.ready).toBe(true);
    expect(report.metrics).toMatchObject({
      repositories: 5, completed: 5, correctionFreePercent: 80,
      migrationSpecificationsReviewed: 3, actionable: 3,
      recommendations: { replace: 3, keep: 2, investigate: 0, insufficient_data: 0 },
    });
  });

  it("fails closed for duplicate, invalid, unreviewed, or incompatible evidence", () => {
    const reviews = [1, 2, 3, 4, 5].map(review);
    reviews[1] = { ...reviews[1], analysisId: reviews[0].analysisId };
    reviews[2] = { ...reviews[2], engineerReview: {
      reviewer: "engineer", reviewedAt: "2026-08-25T00:00:00Z", verdict: "incompatible",
    } };
    const report = evaluateOptimizerBetaReadiness({
      version: 1, generatedAt: "invalid", tenantIsolationVerified: false,
      sourceDeletionVerified: true, reviews,
    });
    expect(report.ready).toBe(false);
    expect(report.checks.filter(({ passed }) => !passed).map(({ id }) => id))
      .toEqual(expect.arrayContaining([
        "evidence.schema", "beta.compatibility_safety", "beta.data_controls",
      ]));
  });

  it("requires auditable metadata for every manually reviewed specification", () => {
    const reviews = [1, 2, 3, 4, 5].map(review);
    reviews[0] = { ...reviews[0], migrationSpecificationReview: undefined };
    const report = evaluateOptimizerBetaReadiness({
      version: 1,
      generatedAt: "2026-08-25T00:00:00Z",
      tenantIsolationVerified: true,
      sourceDeletionVerified: true,
      reviews,
    });
    expect(report.ready).toBe(false);
    expect(report.checks.find(({ id }) => id === "evidence.schema")?.passed).toBe(false);
    expect(report.metrics.migrationSpecificationsReviewed).toBe(2);
  });
});

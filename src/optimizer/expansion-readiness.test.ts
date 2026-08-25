import { describe, expect, it } from "vitest";

import { evaluateOptimizerExpansionReadiness } from "./expansion-readiness.js";

const complete = {
  version: 1,
  category: "object_storage",
  verifiedDesignPartnerMigrations: 2,
  capabilityCatalogReviewed: true,
  pricingCatalogReviewed: true,
  positiveFixtures: 3,
  negativeFixtures: 3,
  deterministicTestsPassed: true,
  operationalReviewCompleted: true,
  privacyReviewCompleted: true,
  documentationPublished: true,
  designPartnerEvidenceAttached: true,
  priorCategoriesReady: [],
};

describe("optimizer O10 expansion readiness", () => {
  it("passes only a fully evidenced first category", () => {
    expect(evaluateOptimizerExpansionReadiness(complete).ready).toBe(true);
  });

  it("blocks premature and out-of-sequence expansion", () => {
    const premature = evaluateOptimizerExpansionReadiness({
      ...complete,
      category: "search",
      verifiedDesignPartnerMigrations: 1,
      priorCategoriesReady: ["object_storage"],
      designPartnerEvidenceAttached: false,
    });
    expect(premature.ready).toBe(false);
    expect(premature.checks.filter(({ passed }) => !passed).map(({ id }) => id))
      .toEqual(expect.arrayContaining([
        "o9.verified_migrations", "category.sequence", "category.design_partner",
      ]));
  });
});

export type OptimizerExpansionCategory =
  | "object_storage"
  | "image_media"
  | "redis_cache"
  | "search"
  | "ai_llm";

export interface OptimizerExpansionEvidenceV1 {
  version: 1;
  category: OptimizerExpansionCategory;
  verifiedDesignPartnerMigrations: number;
  capabilityCatalogReviewed: boolean;
  pricingCatalogReviewed: boolean;
  positiveFixtures: number;
  negativeFixtures: number;
  deterministicTestsPassed: boolean;
  operationalReviewCompleted: boolean;
  privacyReviewCompleted: boolean;
  documentationPublished: boolean;
  designPartnerEvidenceAttached: boolean;
  priorCategoriesReady: OptimizerExpansionCategory[];
}

export interface OptimizerExpansionReadinessReport {
  ready: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

const order: OptimizerExpansionCategory[] = [
  "object_storage", "image_media", "redis_cache", "search", "ai_llm",
];

export function evaluateOptimizerExpansionReadiness(
  value: unknown,
): OptimizerExpansionReadinessReport {
  const evidence = value as Partial<OptimizerExpansionEvidenceV1> | undefined;
  const index = order.indexOf(evidence?.category as OptimizerExpansionCategory);
  const prior = index < 0 ? [] : order.slice(0, index);
  const declaredPrior = Array.isArray(evidence?.priorCategoriesReady)
    ? evidence.priorCategoriesReady : [];
  const checks = [
    { id: "evidence.schema", passed: evidence?.version === 1 && index >= 0,
      detail: "Expansion evidence uses version 1 and a supported category." },
    { id: "o9.verified_migrations", passed:
      Number.isSafeInteger(evidence?.verifiedDesignPartnerMigrations) &&
      Number(evidence?.verifiedDesignPartnerMigrations) >= 2,
      detail: "At least two O9 design-partner migrations reached verified draft PRs." },
    { id: "category.sequence", passed:
      prior.every((category) => declaredPrior.includes(category)),
      detail: "All earlier categories in the approved expansion order are ready." },
    { id: "category.catalogs", passed:
      evidence?.capabilityCatalogReviewed === true && evidence.pricingCatalogReviewed === true,
      detail: "Capability and pricing catalogs received explicit review." },
    { id: "category.fixtures", passed:
      Number.isSafeInteger(evidence?.positiveFixtures) && Number(evidence?.positiveFixtures) > 0 &&
      Number.isSafeInteger(evidence?.negativeFixtures) && Number(evidence?.negativeFixtures) > 0,
      detail: "Reviewed positive and negative fixtures exist." },
    { id: "category.tests", passed: evidence?.deterministicTestsPassed === true,
      detail: "Deterministic detection, compatibility, pricing, and recommendation tests pass." },
    { id: "category.reviews", passed:
      evidence?.operationalReviewCompleted === true && evidence.privacyReviewCompleted === true,
      detail: "Operational and privacy reviews are complete." },
    { id: "category.documentation", passed: evidence?.documentationPublished === true,
      detail: "Support boundaries and limitations are published." },
    { id: "category.design_partner", passed: evidence?.designPartnerEvidenceAttached === true,
      detail: "Reviewed design-partner evidence is attached." },
  ];
  return { ready: checks.every(({ passed }) => passed), checks };
}

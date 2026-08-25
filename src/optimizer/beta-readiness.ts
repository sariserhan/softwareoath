import type { RecommendationType } from "./types.js";

type EngineerVerdict = "actionable" | "not_actionable" | "incompatible";

export interface OptimizerBetaReviewV1 {
  id: string;
  analysisId: string;
  repositorySha256: string;
  outcome: "completed" | "abandoned";
  recommendation: RecommendationType;
  unknownCount: number;
  consequentialCapabilityCorrection: boolean;
  migrationSpecificationGenerated: boolean;
  migrationSpecificationReviewed: boolean;
  ownerOutcome: "accepted" | "rejected" | "pending";
  engineerReview?: {
    reviewer: string;
    reviewedAt: string;
    verdict: EngineerVerdict;
  };
}

export interface OptimizerBetaEvidenceV1 {
  version: 1;
  generatedAt: string;
  tenantIsolationVerified: boolean;
  sourceDeletionVerified: boolean;
  reviews: OptimizerBetaReviewV1[];
}

export interface OptimizerBetaReadinessReport {
  ready: boolean;
  metrics: {
    repositories: number;
    reports: number;
    completed: number;
    abandoned: number;
    unknowns: number;
    consequentialCorrections: number;
    correctionFreePercent: number;
    migrationSpecificationsGenerated: number;
    migrationSpecificationsReviewed: number;
    actionable: number;
    ownerAccepted: number;
    ownerRejected: number;
    recommendations: Record<RecommendationType, number>;
  };
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

const recommendationTypes = new Set<RecommendationType>([
  "keep", "investigate", "replace", "insufficient_data",
]);

function timestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validReview(value: unknown): value is OptimizerBetaReviewV1 {
  const review = value as Partial<OptimizerBetaReviewV1> | undefined;
  const engineer = review?.engineerReview;
  return Boolean(
    review &&
    typeof review.id === "string" && review.id.length > 0 &&
    typeof review.analysisId === "string" && review.analysisId.length > 0 &&
    typeof review.repositorySha256 === "string" &&
    /^[0-9a-f]{64}$/.test(review.repositorySha256) &&
    (review.outcome === "completed" || review.outcome === "abandoned") &&
    recommendationTypes.has(review.recommendation as RecommendationType) &&
    Number.isSafeInteger(review.unknownCount) && Number(review.unknownCount) >= 0 &&
    typeof review.consequentialCapabilityCorrection === "boolean" &&
    typeof review.migrationSpecificationGenerated === "boolean" &&
    typeof review.migrationSpecificationReviewed === "boolean" &&
    (!review.migrationSpecificationReviewed || review.migrationSpecificationGenerated) &&
    ["accepted", "rejected", "pending"].includes(String(review.ownerOutcome)) &&
    (!engineer || (
      typeof engineer.reviewer === "string" && engineer.reviewer.length > 0 &&
      timestamp(engineer.reviewedAt) &&
      ["actionable", "not_actionable", "incompatible"].includes(engineer.verdict)
    )),
  );
}

export function evaluateOptimizerBetaReadiness(
  value: unknown,
): OptimizerBetaReadinessReport {
  const evidence = value as Partial<OptimizerBetaEvidenceV1> | undefined;
  const rawReviews = Array.isArray(evidence?.reviews) ? evidence.reviews : [];
  const reviews = rawReviews.filter(validReview);
  const uniqueIds = new Set(reviews.map(({ id }) => id));
  const uniqueAnalyses = new Set(reviews.map(({ analysisId }) => analysisId));
  const completed = reviews.filter(({ outcome }) => outcome === "completed");
  const replacements = completed.filter(({ recommendation }) => recommendation === "replace");
  const recommendations: Record<RecommendationType, number> = {
    keep: 0, investigate: 0, replace: 0, insufficient_data: 0,
  };
  for (const review of reviews) recommendations[review.recommendation] += 1;
  const consequentialCorrections = completed.filter(
    ({ consequentialCapabilityCorrection }) => consequentialCapabilityCorrection,
  ).length;
  const correctionFreePercent = completed.length
    ? Math.round(((completed.length - consequentialCorrections) / completed.length) * 10_000) / 100
    : 0;
  const metrics = {
    repositories: new Set(reviews.map(({ repositorySha256 }) => repositorySha256)).size,
    reports: reviews.length,
    completed: completed.length,
    abandoned: reviews.filter(({ outcome }) => outcome === "abandoned").length,
    unknowns: reviews.reduce((total, review) => total + review.unknownCount, 0),
    consequentialCorrections,
    correctionFreePercent,
    migrationSpecificationsGenerated: reviews.filter(
      ({ migrationSpecificationGenerated }) => migrationSpecificationGenerated,
    ).length,
    migrationSpecificationsReviewed: reviews.filter(
      ({ migrationSpecificationReviewed }) => migrationSpecificationReviewed,
    ).length,
    actionable: reviews.filter(({ engineerReview }) => engineerReview?.verdict === "actionable").length,
    ownerAccepted: reviews.filter(({ ownerOutcome }) => ownerOutcome === "accepted").length,
    ownerRejected: reviews.filter(({ ownerOutcome }) => ownerOutcome === "rejected").length,
    recommendations,
  };
  const schemaValid = evidence?.version === 1 && timestamp(evidence.generatedAt) &&
    rawReviews.length === reviews.length && uniqueIds.size === reviews.length &&
    uniqueAnalyses.size === reviews.length;
  const checks = [
    { id: "evidence.schema", passed: schemaValid,
      detail: "Evidence is versioned, valid, and has unique review and analysis IDs." },
    { id: "beta.design_partners", passed: metrics.repositories >= 5 && metrics.repositories <= 10,
      detail: "Five to ten distinct design-partner repositories are represented." },
    { id: "beta.correction_rate", passed: completed.length > 0 && correctionFreePercent >= 80,
      detail: "At least 80% of completed reports need no consequential capability correction." },
    { id: "beta.replace_review", passed: replacements.every(({ engineerReview }) => Boolean(engineerReview)),
      detail: "Every REPLACE result has an experienced-engineer review." },
    { id: "beta.specification_review", passed: metrics.migrationSpecificationsReviewed >= 3,
      detail: "At least three generated migration specifications were manually reviewed." },
    { id: "beta.actionable", passed: metrics.actionable >= 3,
      detail: "At least three recommendations were judged actionable." },
    { id: "beta.compatibility_safety", passed: replacements.every(
      ({ engineerReview }) => engineerReview?.verdict !== "incompatible"),
      detail: "No known incompatible replacement was proposed." },
    { id: "beta.data_controls", passed:
      evidence?.tenantIsolationVerified === true && evidence.sourceDeletionVerified === true,
      detail: "Tenant isolation and source deletion are verified." },
  ];
  return { ready: checks.every(({ passed }) => passed), metrics, checks };
}

import { optimizerDigest } from "./contracts";
import type {
  CompatibilityAssessmentV1,
  MigrationEstimateV1,
  PriceRangeV1,
  PricingSnapshotV1,
  RecommendationPolicyV1,
  RecommendationV1,
} from "./types";

function range(
  minimum: number,
  likely: number,
  maximum: number,
): PriceRangeV1 {
  return {
    minimum: Math.max(0, minimum),
    likely: Math.max(0, likely),
    maximum: Math.max(0, maximum),
  };
}

function annualSavings(
  current: PricingSnapshotV1,
  target: PricingSnapshotV1,
): PriceRangeV1 {
  return range(
    (current.monthlyCost.minimum - target.monthlyCost.maximum) * 12,
    (current.monthlyCost.likely - target.monthlyCost.likely) * 12,
    (current.monthlyCost.maximum - target.monthlyCost.minimum) * 12,
  );
}

function riskAdjusted(
  savings: PriceRangeV1,
  estimate: MigrationEstimateV1,
): PriceRangeV1 {
  return range(
    savings.minimum -
      estimate.engineeringCost.maximum -
      estimate.operationalCostChangeAnnual.maximum -
      estimate.riskAllowance.maximum,
    savings.likely -
      estimate.engineeringCost.likely -
      estimate.operationalCostChangeAnnual.likely -
      estimate.riskAllowance.likely,
    savings.maximum -
      estimate.engineeringCost.minimum -
      estimate.operationalCostChangeAnnual.minimum -
      estimate.riskAllowance.minimum,
  );
}

function payback(
  savings: PriceRangeV1,
  estimate: MigrationEstimateV1,
): PriceRangeV1 {
  const monthlyLikely = savings.likely / 12;
  const minimum = savings.maximum > 0
    ? estimate.engineeringCost.minimum / (savings.maximum / 12)
    : Number.MAX_SAFE_INTEGER;
  const likely = monthlyLikely > 0
    ? estimate.engineeringCost.likely / monthlyLikely
    : Number.MAX_SAFE_INTEGER;
  const maximum = savings.minimum > 0
    ? estimate.engineeringCost.maximum / (savings.minimum / 12)
    : Number.MAX_SAFE_INTEGER;
  return range(minimum, likely, maximum);
}

export function recommendServiceChange(options: {
  compatibility: CompatibilityAssessmentV1;
  currentPricing?: PricingSnapshotV1;
  targetPricing?: PricingSnapshotV1;
  migrationEstimate: MigrationEstimateV1;
  policy: RecommendationPolicyV1;
  policyVersion: string;
}): RecommendationV1 {
  const {
    compatibility,
    currentPricing,
    targetPricing,
    migrationEstimate,
    policy,
    policyVersion,
  } = options;
  const empty = range(0, 0, 0);
  const inputSha256 = optimizerDigest(options);
  if (compatibility.status === "incompatible") {
    return {
      version: 1,
      type: "keep",
      sourceServiceId: compatibility.sourceServiceId,
      targetServiceId: compatibility.targetServiceId,
      compatibilityStatus: compatibility.status,
      annualSavings: empty,
      riskAdjustedAnnualValue: empty,
      paybackMonths: empty,
      reasons: ["A required capability is unsupported by the target service."],
      unknowns: compatibility.unknowns,
      policyVersion,
      inputSha256,
    };
  }
  if (
    compatibility.status === "unverified" ||
    compatibility.unknowns.length ||
    !currentPricing ||
    !targetPricing ||
    currentPricing.stale ||
    targetPricing.stale
  ) {
    return {
      version: 1,
      type: currentPricing && targetPricing ? "investigate" : "insufficient_data",
      sourceServiceId: compatibility.sourceServiceId,
      targetServiceId: compatibility.targetServiceId,
      compatibilityStatus: compatibility.status,
      annualSavings: empty,
      riskAdjustedAnnualValue: empty,
      paybackMonths: empty,
      reasons: ["Consequential compatibility or pricing facts remain unresolved."],
      unknowns: compatibility.unknowns,
      policyVersion,
      inputSha256,
    };
  }
  const savings = annualSavings(currentPricing, targetPricing);
  const value = riskAdjusted(savings, migrationEstimate);
  const months = payback(savings, migrationEstimate);
  const changedAllowed =
    compatibility.status !== "compatible_with_changes" ||
    policy.allowReplaceWithChangedCapabilities;
  const replace =
    changedAllowed &&
    savings.likely >= policy.minimumAnnualSavings &&
    value.likely > 0 &&
    months.likely <= policy.maximumPaybackMonths;
  return {
    version: 1,
    type: replace ? "replace" : "keep",
    sourceServiceId: compatibility.sourceServiceId,
    targetServiceId: compatibility.targetServiceId,
    compatibilityStatus: compatibility.status,
    annualSavings: savings,
    riskAdjustedAnnualValue: value,
    paybackMonths: months,
    reasons: replace
      ? ["Required capabilities pass and risk-adjusted value clears owner policy."]
      : ["The estimated savings do not justify migration cost and operational risk."],
    unknowns: [],
    policyVersion,
    inputSha256,
  };
}

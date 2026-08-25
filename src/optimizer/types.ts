export type OptimizerProvenance =
  | "observed"
  | "inferred"
  | "owner_confirmed"
  | "provider_derived"
  | "assumed"
  | "estimated";

export type EvidenceConfidence = "very_high" | "high" | "medium" | "low";
export type CapabilityRequirement = "required" | "optional";
export type CapabilitySupport =
  | "exact"
  | "supported_with_changes"
  | "unsupported"
  | "unverified";
export type CompatibilityStatus =
  | "compatible"
  | "compatible_with_changes"
  | "unverified"
  | "incompatible";
export type RecommendationType =
  | "keep"
  | "investigate"
  | "replace"
  | "insufficient_data";

export interface SourceEvidenceV1 {
  version: 1;
  provenance: OptimizerProvenance;
  confidence: EvidenceConfidence;
  file: string;
  lineStart?: number;
  lineEnd?: number;
  reason: string;
  snippetSha256?: string;
}

export interface ServiceObservationV1 {
  version: 1;
  serviceId: string;
  category: string;
  status: "active" | "ambiguous" | "inactive";
  confidence: EvidenceConfidence;
  evidence: SourceEvidenceV1[];
  analyzedCommit: string;
}

export interface OwnerObservationDecisionV1 {
  version: 1;
  id: string;
  serviceId: string;
  decision: "confirmed" | "rejected" | "corrected";
  correctedStatus?: ServiceObservationV1["status"];
  correctedCapabilityIds?: string[];
  reason: string;
  actor: {
    provider: "github";
    providerUserId: string;
    login: string;
  };
  authorization: {
    permission: "admin" | "maintain" | "push";
    verifiedAt: string;
  };
  createdAt: string;
}

export interface CapabilityEvidenceV1 {
  version: 1;
  serviceId: string;
  capabilityId: string;
  requirement: CapabilityRequirement;
  confidence: EvidenceConfidence;
  evidence: SourceEvidenceV1[];
  ownerConfirmed: boolean;
}

export interface CapabilityAssessmentV1 {
  capabilityId: string;
  requirement: CapabilityRequirement;
  support: CapabilitySupport;
  notes: string[];
}

export interface CatalogSourceV1 {
  url: string;
  verifiedAt: string;
}

export interface CompatibilityAssessmentV1 {
  version: 1;
  sourceServiceId: string;
  targetServiceId: string;
  status: CompatibilityStatus;
  capabilities: CapabilityAssessmentV1[];
  semanticDifferences: string[];
  operationalDifferences: string[];
  unknowns: string[];
  catalogVersion: string;
  catalogVerifiedAt?: string;
  catalogSources?: CatalogSourceV1[];
}

export interface OwnerUsageInputV1 {
  version: 1;
  monthlyVolume?: number;
  currentMonthlyBill?: number;
  currentPlan?: string;
  currency: string;
  region?: string;
  engineeringHourlyCost?: number;
  dedicatedIpRequired?: boolean;
  averageAttachmentMegabytes?: number;
  criticalOperationalRequirements?: string[];
  confirmedAt: string;
  confirmedBy: string;
}

export interface PriceRangeV1 {
  minimum: number;
  likely: number;
  maximum: number;
}

export interface PricingPlanV1 {
  id: string;
  monthlyMinimum: number;
  includedMonthlyUnits: number;
  overageUnitSize: number;
  overagePrice: number;
  maximumMonthlyUnits?: number;
}

export interface PricingAddOnV1 {
  id: string;
  unit: "month" | "gigabyte";
  unitPrice: number;
}

export interface ProviderPricingRuleV1 {
  version: 1;
  serviceId: "resend" | "ses" | "postmark";
  currency: "USD";
  region?: string;
  billingModel: "plan" | "usage";
  plans: PricingPlanV1[];
  addOns: PricingAddOnV1[];
  sourceUrl: string;
  effectiveAt: string;
  verifiedAt: string;
  pricingVersion: string;
  assumptions: string[];
  excludedCosts: string[];
}

export interface EmailPricingCatalogV1 {
  version: 1;
  catalogVersion: string;
  reviewStatus: "approved" | "review_required";
  reviewedAt?: string;
  reviewedBy?: string;
  providers: Record<ProviderPricingRuleV1["serviceId"], ProviderPricingRuleV1>;
}

export interface OwnerPricingOverrideV1 {
  version: 1;
  serviceId: ProviderPricingRuleV1["serviceId"];
  monthlyCost: PriceRangeV1;
  reason: string;
  confirmedAt: string;
  confirmedBy: string;
}

export interface PricingEstimateResultV1 {
  version: 1;
  completeness: "complete" | "incomplete";
  missingInputs: string[];
  snapshot?: PricingSnapshotV1;
}

export interface PricingSnapshotV1 {
  version: 1;
  serviceId: string;
  currency: string;
  region?: string;
  monthlyCost: PriceRangeV1;
  sourceUrl: string;
  effectiveAt: string;
  verifiedAt: string;
  pricingVersion: string;
  assumptions: string[];
  excludedCosts: string[];
  stale: boolean;
}

export interface MigrationEstimateV1 {
  engineeringHours: PriceRangeV1;
  engineeringCost: PriceRangeV1;
  operationalCostChangeAnnual: PriceRangeV1;
  riskAllowance: PriceRangeV1;
}

export interface RecommendationPolicyV1 {
  version: 1;
  minimumAnnualSavings: number;
  maximumPaybackMonths: number;
  allowReplaceWithChangedCapabilities: boolean;
}

export interface RecommendationV1 {
  version: 1;
  type: RecommendationType;
  sourceServiceId: string;
  targetServiceId?: string;
  compatibilityStatus: CompatibilityStatus;
  annualSavings: PriceRangeV1;
  riskAdjustedAnnualValue: PriceRangeV1;
  paybackMonths: PriceRangeV1;
  reasons: string[];
  unknowns: string[];
  policyVersion: string;
  inputSha256: string;
}

export interface MigrationSpecificationV1 {
  version: 1;
  id: string;
  repository: string;
  baseCommit: string;
  sourceServiceId: string;
  targetServiceId: string;
  recommendationSha256: string;
  evidenceSha256: string;
  requiredBehavior: string[];
  knownIncompatibilities: string[];
  allowedPaths: string[];
  configurationChanges: string[];
  infrastructureChanges: string[];
  migrationSequence: string[];
  verificationRequirements: string[];
  rolloutPlan: string[];
  rollbackPlan: string[];
  expectedMonthlyCost: PriceRangeV1;
  assumptions: string[];
  unresolvedDecisions: string[];
  generatedAt: string;
  generatorVersion: string;
}

export interface GoldFixtureExpectationV1 {
  version: 1;
  fixture: string;
  serviceId: "resend";
  expectedStatus: ServiceObservationV1["status"];
  expectedCapabilities: string[];
  excludedSignals: string[];
  notes: string[];
}

export interface EvaluationMetricsV1 {
  version: 1;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
}
export type OptimizerSignalKind =
  | "manifest_dependency"
  | "active_import"
  | "environment_name"
  | "api_hostname"
  | "infrastructure_declaration"
  | "runtime_call"
  | "wrapper_call";

export interface OptimizerSignalV1 {
  version: 1;
  kind: OptimizerSignalKind;
  value: string;
  evidence: SourceEvidenceV1;
}

export interface OptimizerAnalysisRecordV1 {
  version: 1;
  id: string;
  tenantKey: string;
  repositoryId: string;
  repository: string;
  commit: string;
  status: "completed" | "failed";
  filesAnalyzed: number;
  bytesAnalyzed: number;
  signals: OptimizerSignalV1[];
  observations: ServiceObservationV1[];
  capabilities: CapabilityEvidenceV1[];
  ownerDecisions: OwnerObservationDecisionV1[];
  warnings: string[];
  analyzerVersion: string;
  createdAt: string;
  completedAt: string;
  unknowns: string[];
  error?: string;
}

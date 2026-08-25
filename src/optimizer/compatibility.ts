import type {
  CapabilityAssessmentV1,
  CompatibilityAssessmentV1,
  CompatibilityStatus,
} from "./types.js";

export function compatibilityStatus(
  capabilities: CapabilityAssessmentV1[],
): CompatibilityStatus {
  const required = capabilities.filter((item) => item.requirement === "required");
  if (required.some((item) => item.support === "unsupported")) return "incompatible";
  if (required.some((item) => item.support === "unverified")) return "unverified";
  if (required.some((item) => item.support === "supported_with_changes")) {
    return "compatible_with_changes";
  }
  return "compatible";
}

export function createCompatibilityAssessment(options: {
  sourceServiceId: string;
  targetServiceId: string;
  capabilities: CapabilityAssessmentV1[];
  semanticDifferences?: string[];
  operationalDifferences?: string[];
  unknowns?: string[];
  catalogVersion: string;
  catalogVerifiedAt?: string;
  catalogSources?: CompatibilityAssessmentV1["catalogSources"];
}): CompatibilityAssessmentV1 {
  if (!options.capabilities.length) {
    throw new Error("Compatibility requires at least one observed capability.");
  }
  return {
    version: 1,
    sourceServiceId: options.sourceServiceId,
    targetServiceId: options.targetServiceId,
    status: compatibilityStatus(options.capabilities),
    capabilities: options.capabilities,
    semanticDifferences: options.semanticDifferences ?? [],
    operationalDifferences: options.operationalDifferences ?? [],
    unknowns: options.unknowns ?? [],
    catalogVersion: options.catalogVersion,
    catalogVerifiedAt: options.catalogVerifiedAt,
    catalogSources: options.catalogSources,
  };
}

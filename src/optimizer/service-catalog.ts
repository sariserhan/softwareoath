import { createCompatibilityAssessment } from "./compatibility.js";
import type { CapabilityEvidenceV1, CapabilitySupport, CompatibilityAssessmentV1 } from "./types.js";

interface Target {
  serviceId: string;
  catalogVersion: string;
  support: Record<string, CapabilitySupport>;
  differences: string[];
  unknowns: string[];
}
const targets: Record<string, Target[]> = {
  stripe: [{ serviceId: "adyen", catalogVersion: "payments-o1",
    support: { payment_processing: "supported_with_changes", subscriptions: "unverified", webhooks: "supported_with_changes" },
    differences: ["Payment method, subscription, webhook, dispute, and settlement semantics differ."],
    unknowns: ["Merchant region, payment methods, compliance scope, and negotiated pricing require owner confirmation."] }],
  sentry: [{ serviceId: "opentelemetry", catalogVersion: "observability-o1",
    support: { error_tracking: "supported_with_changes", performance_tracing: "supported_with_changes", release_health: "unverified" },
    differences: ["OpenTelemetry provides telemetry standards; a storage and incident backend must also be selected."],
    unknowns: ["Telemetry backend, retention, alerting, symbolication, and operational ownership are unresolved."] }],
  supabase: [{ serviceId: "firebase", catalogVersion: "backend-platform-o1",
    support: { postgres_database: "unsupported", authentication: "supported_with_changes",
      object_storage: "supported_with_changes", realtime: "supported_with_changes" },
    differences: ["Firebase data models and query semantics are not PostgreSQL-compatible."],
    unknowns: ["Data migration volume, regional requirements, and product-specific extensions are unresolved."] }],
  cloudinary: [{ serviceId: "imagekit", catalogVersion: "media-o1",
    support: { object_storage: "supported_with_changes", image_transformation: "supported_with_changes",
      cdn_delivery: "supported_with_changes" },
    differences: ["Transformation URLs, presets, asset identifiers, and delivery behavior differ."],
    unknowns: ["Asset volume, transformation inventory, origin ownership, and pricing are unresolved."] }],
};
export function migrationTargetsFor(sourceServiceId: string): string[] {
  return (targets[sourceServiceId] ?? []).map(({ serviceId }) => serviceId);
}
export function assessServiceCompatibility(options: {
  sourceServiceId: string; targetServiceId: string; capabilities: CapabilityEvidenceV1[];
}): CompatibilityAssessmentV1 {
  const target = targets[options.sourceServiceId]?.find(({ serviceId }) =>
    serviceId === options.targetServiceId);
  if (!target) throw new Error("No compatibility catalog for " +
    options.sourceServiceId + " to " + options.targetServiceId + ".");
  return createCompatibilityAssessment({
    sourceServiceId: options.sourceServiceId,
    targetServiceId: target.serviceId,
    capabilities: options.capabilities.map((capability) => ({
      capabilityId: capability.capabilityId, requirement: capability.requirement,
      support: target.support[capability.capabilityId] ?? "unverified",
      notes: target.support[capability.capabilityId]
        ? [] : ["Capability is absent from the reviewed target catalog."],
    })),
    semanticDifferences: target.differences,
    operationalDifferences: [],
    unknowns: target.unknowns,
    catalogVersion: target.catalogVersion,
  });
}

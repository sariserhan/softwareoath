import type { CapabilityEvidenceV1, OptimizerSignalV1, ServiceObservationV1 } from "./types.js";

export interface ServiceDetectorResult {
  observation?: ServiceObservationV1;
  capabilities: CapabilityEvidenceV1[];
  unknowns: string[];
}
export interface ServiceDetector {
  serviceId: string;
  category: string;
  dependencies: string[];
  environmentPrefixes: string[];
  hostnames: string[];
  capabilities: string[];
}
export const serviceDetectors: ServiceDetector[] = [
  { serviceId: "stripe", category: "payments", dependencies: ["stripe", "@stripe/stripe-js"],
    environmentPrefixes: ["STRIPE_"], hostnames: ["api.stripe.com"],
    capabilities: ["payment_processing", "subscriptions", "webhooks"] },
  { serviceId: "sentry", category: "observability", dependencies: ["@sentry/", "sentry-sdk"],
    environmentPrefixes: ["SENTRY_"], hostnames: ["sentry.io"],
    capabilities: ["error_tracking", "performance_tracing", "release_health"] },
  { serviceId: "twilio", category: "communications", dependencies: ["twilio"],
    environmentPrefixes: ["TWILIO_"], hostnames: ["api.twilio.com"],
    capabilities: ["sms_send", "voice_calls", "delivery_webhooks"] },
  { serviceId: "supabase", category: "backend_platform", dependencies: ["@supabase/"],
    environmentPrefixes: ["SUPABASE_"], hostnames: ["supabase.co"],
    capabilities: ["postgres_database", "authentication", "object_storage", "realtime"] },
  { serviceId: "clerk", category: "authentication", dependencies: ["@clerk/"],
    environmentPrefixes: ["CLERK_"], hostnames: ["clerk.com", "clerk.accounts.dev"],
    capabilities: ["user_authentication", "session_management", "organizations"] },
  { serviceId: "openai", category: "ai_api", dependencies: ["openai"],
    environmentPrefixes: ["OPENAI_"], hostnames: ["api.openai.com"],
    capabilities: ["text_generation", "embeddings", "tool_calling"] },
  { serviceId: "cloudinary", category: "media", dependencies: ["cloudinary"],
    environmentPrefixes: ["CLOUDINARY_"], hostnames: ["api.cloudinary.com", "res.cloudinary.com"],
    capabilities: ["object_storage", "image_transformation", "cdn_delivery"] },
];

function dependencyMatch(value: string, patterns: string[]) {
  return patterns.some((pattern) => pattern.endsWith("/")
    ? value.startsWith(pattern) : value === pattern);
}
export function detectRegisteredServices(options: {
  commit: string;
  signals: OptimizerSignalV1[];
}): ServiceDetectorResult[] {
  return serviceDetectors.flatMap((detector) => {
    const relevant = options.signals.filter((signal) =>
      ((signal.kind === "manifest_dependency" || signal.kind === "active_import") &&
        dependencyMatch(signal.value, detector.dependencies)) ||
      (signal.kind === "environment_name" &&
        detector.environmentPrefixes.some((prefix) => signal.value.startsWith(prefix))) ||
      (signal.kind === "api_hostname" &&
        detector.hostnames.some((hostname) =>
          signal.value === hostname || signal.value.endsWith("." + hostname))),
    );
    if (!relevant.length) return [];
    const activeEvidence = relevant.filter((signal) =>
      signal.kind === "active_import" || signal.kind === "api_hostname");
    const status = activeEvidence.length ? "active" : "ambiguous";
    const evidence = relevant.map((signal) => signal.evidence);
    return [{
      observation: {
        version: 1, serviceId: detector.serviceId, category: detector.category,
        status, confidence: activeEvidence.length ? "high" : "medium",
        evidence, analyzedCommit: options.commit,
      },
      capabilities: detector.capabilities.map((capabilityId) => ({
        version: 1, serviceId: detector.serviceId, capabilityId,
        requirement: "required", confidence: activeEvidence.length ? "high" : "medium",
        evidence, ownerConfirmed: false,
      })),
      unknowns: status === "ambiguous"
        ? [detector.serviceId + " configuration was observed without corroborated runtime usage."]
        : [],
    } satisfies ServiceDetectorResult];
  });
}

import { describe, expect, it } from "vitest";
import { assessServiceCompatibility, migrationTargetsFor } from "./service-catalog.js";
describe("service compatibility catalogs", () => {
  it("assesses a non-email migration conservatively", () => {
    expect(migrationTargetsFor("stripe")).toContain("adyen");
    const result = assessServiceCompatibility({
      sourceServiceId: "stripe", targetServiceId: "adyen",
      capabilities: [{
        version: 1, serviceId: "stripe", capabilityId: "subscriptions",
        requirement: "required", confidence: "high", evidence: [], ownerConfirmed: false,
      }],
    });
    expect(result.status).toBe("unverified");
    expect(result.unknowns.length).toBeGreaterThan(0);
  });
  it("marks incompatible platform data models", () => {
    const result = assessServiceCompatibility({
      sourceServiceId: "supabase", targetServiceId: "firebase",
      capabilities: [{
        version: 1, serviceId: "supabase", capabilityId: "postgres_database",
        requirement: "required", confidence: "high", evidence: [], ownerConfirmed: false,
      }],
    });
    expect(result.status).toBe("incompatible");
  });
});

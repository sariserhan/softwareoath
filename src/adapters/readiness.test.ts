import { describe, expect, it } from "vitest";
import { evaluateAdapterReadiness } from "./readiness.js";

describe("ecosystem adapter readiness", () => {
  it("fails closed until every per-adapter requirement has evidence", () => {
    const base = { version: 1, adapterId: "pnpm", readOnlyDiscovery: true,
      structuredUpdatesAndAdvisories: true, executionPolicyDocumented: true,
      conservativeSelection: true, deterministicUpdates: true, exactScopeAndProof: true,
      unitFixturesPassed: true, isolatedIntegrationPassed: true,
      endToEndRepairPassed: true, supportDocumentationPublished: true };
    expect(evaluateAdapterReadiness(base).ready).toBe(true);
    expect(evaluateAdapterReadiness({ ...base, endToEndRepairPassed: false }).ready).toBe(false);
  });
});

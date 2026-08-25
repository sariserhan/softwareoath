import { describe, expect, it } from "vitest";

import { createCompatibilityAssessment } from "./compatibility";
import {
  assessOperationalComplexity,
  estimateMigrationEffort,
} from "./migration-estimate";
import { recommendServiceChange } from "./recommendation";
import type {
  CompatibilityAssessmentV1,
  MigrationEstimateV1,
  PricingSnapshotV1,
} from "./types";

function pricing(serviceId: string, monthly: number, stale = false): PricingSnapshotV1 {
  return {
    version: 1,
    serviceId,
    currency: "USD",
    monthlyCost: { minimum: monthly, likely: monthly, maximum: monthly },
    sourceUrl: "https://example.test/pricing",
    effectiveAt: "2026-08-25T00:00:00.000Z",
    verifiedAt: "2026-08-25T00:00:00.000Z",
    pricingVersion: "pricing-1",
    assumptions: [],
    excludedCosts: [],
    stale,
  };
}

function compatibility(): CompatibilityAssessmentV1 {
  return createCompatibilityAssessment({
    sourceServiceId: "resend",
    targetServiceId: "postmark",
    capabilities: [{
      capabilityId: "transactional_send",
      requirement: "required",
      support: "exact",
      notes: [],
    }],
    catalogVersion: "email-1",
  });
}

function estimate(operationalLikely = 0): MigrationEstimateV1 {
  return {
    engineeringHours: { minimum: 2, likely: 4, maximum: 8 },
    engineeringCost: { minimum: 200, likely: 400, maximum: 800 },
    operationalCostChangeAnnual: {
      minimum: operationalLikely,
      likely: operationalLikely,
      maximum: operationalLikely,
    },
    riskAllowance: { minimum: 20, likely: 80, maximum: 280 },
  };
}

const policy = {
  version: 1 as const,
  minimumAnnualSavings: 500,
  maximumPaybackMonths: 12,
  allowReplaceWithChangedCapabilities: false,
  maximumAnnualOperationalCost: 1_000,
};

describe("optimizer O5 deterministic estimates", () => {
  it("models operational burden independently from code effort", () => {
    const postmark = assessOperationalComplexity({
      version: 1,
      targetServiceId: "postmark",
      deliveryEventsRequired: false,
      inboundEmailRequired: false,
      dedicatedIpRequired: false,
      multipleRegionsRequired: false,
      ownerHourlyCost: 100,
    });
    const ses = assessOperationalComplexity({
      version: 1,
      targetServiceId: "ses",
      deliveryEventsRequired: true,
      inboundEmailRequired: true,
      dedicatedIpRequired: true,
      multipleRegionsRequired: true,
      ownerHourlyCost: 100,
    });
    expect(postmark).toMatchObject({ level: "low", annualCost: { likely: 0 } });
    expect(ses.level).toBe("high");
    expect(ses.annualCost.likely).toBeGreaterThan(10_000);
  });

  it("increases effort from files, APIs, config, DNS, infrastructure, data, tests, rollout, and rollback", () => {
    const operational = assessOperationalComplexity({
      version: 1,
      targetServiceId: "postmark",
      deliveryEventsRequired: false,
      inboundEmailRequired: false,
      dedicatedIpRequired: false,
      multipleRegionsRequired: false,
      ownerHourlyCost: 100,
    });
    const small = estimateMigrationEffort({
      input: {
        version: 1, affectedFiles: 1, changedCapabilities: 0,
        configurationChanges: 1, dnsChanges: 0, infrastructureChanges: 0,
        dataMovement: "none", testingScope: "focused",
        rolloutComplexity: "simple", rollbackComplexity: "simple",
        ownerHourlyCost: 100,
      },
      operationalComplexity: operational,
    });
    const large = estimateMigrationEffort({
      input: {
        version: 1, affectedFiles: 12, changedCapabilities: 5,
        configurationChanges: 4, dnsChanges: 3, infrastructureChanges: 2,
        dataMovement: "substantial", testingScope: "end_to_end",
        rolloutComplexity: "parallel", rollbackComplexity: "stateful",
        ownerHourlyCost: 100,
      },
      operationalComplexity: operational,
    });
    expect(large.engineeringHours.likely).toBeGreaterThan(small.engineeringHours.maximum);
    expect(large.effortDrivers?.join(" ")).toContain("DNS");
    expect(large.engineeringCost.likely).toBe(large.engineeringHours.likely * 100);
  });
});

describe("optimizer O5 decision matrix", () => {
  it("keeps a cheaper alternative when operational burden exceeds owner policy", () => {
    const result = recommendServiceChange({
      compatibility: compatibility(),
      currentPricing: pricing("resend", 200),
      targetPricing: pricing("postmark", 10),
      migrationEstimate: estimate(2_000),
      policy,
      policyVersion: "policy-1",
    });
    expect(result.type).toBe("keep");
    expect(result.annualSavings.likely).toBeGreaterThan(2_000);
  });

  it("returns explicit missing and stale pricing unknowns", () => {
    const missing = recommendServiceChange({
      compatibility: compatibility(),
      targetPricing: pricing("postmark", 10),
      migrationEstimate: estimate(), policy, policyVersion: "policy-1",
    });
    expect(missing).toMatchObject({
      type: "insufficient_data",
      unknowns: ["Current pricing is missing."],
    });
    const stale = recommendServiceChange({
      compatibility: compatibility(),
      currentPricing: pricing("resend", 200, true),
      targetPricing: pricing("postmark", 10),
      migrationEstimate: estimate(), policy, policyVersion: "policy-1",
    });
    expect(stale.type).toBe("investigate");
    expect(stale.unknowns).toContain("Pricing is stale.");
  });

  it("investigates contradictory evidence before doing economics", () => {
    const contradictory = {
      ...compatibility(),
      status: "compatible" as const,
      capabilities: [{
        capabilityId: "inbound_email", requirement: "required" as const,
        support: "unsupported" as const, notes: [],
      }],
    };
    const result = recommendServiceChange({
      compatibility: contradictory,
      currentPricing: pricing("resend", 1_000),
      targetPricing: pricing("postmark", 1),
      migrationEstimate: estimate(), policy, policyVersion: "policy-1",
    });
    expect(result).toMatchObject({
      type: "investigate",
      annualSavings: { likely: 0 },
    });
  });

  it("produces stable input digests that change with policy inputs", () => {
    const options = {
      compatibility: compatibility(),
      currentPricing: pricing("resend", 200),
      targetPricing: pricing("postmark", 10),
      migrationEstimate: estimate(), policy, policyVersion: "policy-1",
    };
    const first = recommendServiceChange(options);
    const second = recommendServiceChange(options);
    const changed = recommendServiceChange({ ...options, policyVersion: "policy-2" });
    expect(first.inputSha256).toBe(second.inputSha256);
    expect(first.inputSha256).not.toBe(changed.inputSha256);
    expect(first.policyVersion).toBe("policy-1");
  });
});

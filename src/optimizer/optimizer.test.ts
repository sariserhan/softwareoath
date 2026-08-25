import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertProvenance,
  optimizerDigest,
  parseGoldFixtureExpectation,
  parseMigrationSpecification,
  parseMigrationOutcome,
  parsePriceRange,
  parseRecommendationPolicy,
} from "./contracts.js";
import {
  compatibilityStatus,
  createCompatibilityAssessment,
} from "./compatibility.js";
import { evaluateLabels } from "./evaluation.js";
import { recommendServiceChange } from "./recommendation.js";
import type {
  CapabilityAssessmentV1,
  MigrationEstimateV1,
  PricingSnapshotV1,
} from "./types.js";

const zeroEstimate: MigrationEstimateV1 = {
  engineeringHours: { minimum: 1, likely: 2, maximum: 3 },
  engineeringCost: { minimum: 100, likely: 200, maximum: 300 },
  operationalCostChangeAnnual: { minimum: 0, likely: 0, maximum: 0 },
  riskAllowance: { minimum: 0, likely: 50, maximum: 100 },
};

function pricing(
  serviceId: string,
  monthly: number,
  stale = false,
): PricingSnapshotV1 {
  return {
    version: 1,
    serviceId,
    currency: "USD",
    monthlyCost: { minimum: monthly, likely: monthly, maximum: monthly },
    sourceUrl: "https://example.test/pricing",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    verifiedAt: "2026-08-20T00:00:00.000Z",
    pricingVersion: "2026-08-01",
    assumptions: [],
    excludedCosts: [],
    stale,
  };
}

const exactCapability: CapabilityAssessmentV1 = {
  capabilityId: "transactional_send",
  requirement: "required",
  support: "exact",
  notes: [],
};

describe("optimizer O0 contracts", () => {
  it("validates ordered ranges, policy, provenance, and stable digests", () => {
    expect(parsePriceRange({ minimum: 1, likely: 2, maximum: 3 })).toEqual({
      minimum: 1,
      likely: 2,
      maximum: 3,
    });
    expect(() =>
      parsePriceRange({ minimum: 3, likely: 2, maximum: 1 }),
    ).toThrow(/minimum <= likely/);
    expect(parseRecommendationPolicy({
      version: 1,
      minimumAnnualSavings: 500,
      maximumPaybackMonths: 12,
      allowReplaceWithChangedCapabilities: false,
    }).maximumPaybackMonths).toBe(12);
    expect(assertProvenance("owner_confirmed")).toBe("owner_confirmed");
    expect(() => assertProvenance("model_fact")).toThrow(/invalid/);
    expect(optimizerDigest({ b: 2, a: 1 })).toBe(
      optimizerDigest({ a: 1, b: 2 }),
    );
  });

  it("validates bounded migration specifications and rejects path escape", () => {
    const specification = {
      version: 1,
      id: "MIGRATION-1",
      repository: "acme/shop",
      baseCommit: "a".repeat(40),
      sourceServiceId: "resend",
      targetServiceId: "postmark",
      recommendationSha256: "b".repeat(64),
      evidenceSha256: "c".repeat(64),
      requiredBehavior: ["Send transactional receipts."],
      knownIncompatibilities: [],
      allowedPaths: ["src/email.ts"],
      configurationChanges: ["Replace environment variable name."],
      infrastructureChanges: [],
      migrationSequence: ["Add target adapter.", "Switch call sites."],
      verificationRequirements: ["Run the email contract tests."],
      rolloutPlan: ["Deploy to preview."],
      rollbackPlan: ["Restore the Resend adapter."],
      expectedMonthlyCost: { minimum: 10, likely: 12, maximum: 15 },
      assumptions: ["10,000 messages monthly."],
      unresolvedDecisions: [],
      generatedAt: "2026-08-24T00:00:00.000Z",
      generatorVersion: "optimizer-o0",
    };
    expect(parseMigrationSpecification(specification).baseCommit).toHaveLength(40);
    expect(() => parseMigrationSpecification({
      ...specification,
      allowedPaths: ["../software-oath.yml"],
    })).toThrow(/repository-relative/);
  });

  it("validates immutable reviewed migration outcomes", () => {
    const outcome = {
      version: 1,
      id: "OUTCOME-1",
      tenantKey: "tenant-1",
      repositoryId: "repo-1",
      repository: "acme/shop",
      baseCommit: "a".repeat(40),
      specificationSha256: "b".repeat(64),
      runId: "run-1",
      status: "verified_draft_pr",
      pullRequestUrl: "https://github.com/acme/shop/pull/7",
      predictedEngineeringHours: { minimum: 2, likely: 4, maximum: 8 },
      reviewedEngineeringHours: 5,
      reviewedBy: "engineer@example.test",
      reviewedAt: "2026-08-25T12:00:00.000Z",
      recordedAt: "2026-08-25T12:00:00.000Z",
      provenance: "owner_confirmed",
      contentSha256: "c".repeat(64),
    };
    expect(parseMigrationOutcome(outcome).status).toBe("verified_draft_pr");
    expect(() => parseMigrationOutcome({ ...outcome, pullRequestUrl: undefined }))
      .toThrow(/pullRequestUrl/);
    expect(() => parseMigrationOutcome({ ...outcome, reviewedAt: undefined }))
      .toThrow(/paired/);
  });

  it("loads and validates the complete reviewed fixture corpus", async () => {
    const root = join(process.cwd(), "fixtures", "optimizer");
    const directories = await readdir(root, { withFileTypes: true });
    const expectations = await Promise.all(
      directories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) =>
          parseGoldFixtureExpectation(JSON.parse(
            await readFile(join(root, entry.name, "expectation.json"), "utf8"),
          )),
        ),
    );
    expect(expectations).toHaveLength(11);
    expect(expectations.filter((item) => item.expectedStatus === "active"))
      .toHaveLength(8);
    expect(expectations.find((item) => item.fixture === "resend-unused"))
      .toMatchObject({ expectedStatus: "inactive", expectedCapabilities: [] });
    expect(expectations.find((item) => item.fixture === "resend-ambiguous"))
      .toMatchObject({ expectedStatus: "ambiguous" });
  });
});

describe("optimizer compatibility gates", () => {
  it("never lets optional coverage hide an unsupported required capability", () => {
    const capabilities: CapabilityAssessmentV1[] = [
      {
        capabilityId: "inbound_email",
        requirement: "required",
        support: "unsupported",
        notes: [],
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        capabilityId: "optional_" + index,
        requirement: "optional" as const,
        support: "exact" as const,
        notes: [],
      })),
    ];
    expect(compatibilityStatus(capabilities)).toBe("incompatible");
  });

  it("distinguishes changed and unverified required semantics", () => {
    expect(compatibilityStatus([
      exactCapability,
      {
        capabilityId: "delivery_webhooks",
        requirement: "required",
        support: "supported_with_changes",
        notes: ["Event names differ."],
      },
    ])).toBe("compatible_with_changes");
    expect(compatibilityStatus([
      exactCapability,
      {
        capabilityId: "inbound_email",
        requirement: "required",
        support: "unverified",
        notes: [],
      },
    ])).toBe("unverified");
  });
});

describe("optimizer recommendation policy", () => {
  const policy = {
    version: 1 as const,
    minimumAnnualSavings: 500,
    maximumPaybackMonths: 12,
    allowReplaceWithChangedCapabilities: false,
  };

  it("keeps an incompatible target even when it could be cheaper", () => {
    const compatibility = createCompatibilityAssessment({
      sourceServiceId: "resend",
      targetServiceId: "ses",
      capabilities: [{
        capabilityId: "inbound_email",
        requirement: "required",
        support: "unsupported",
        notes: [],
      }],
      catalogVersion: "email-1",
    });
    expect(recommendServiceChange({
      compatibility,
      currentPricing: pricing("resend", 100),
      targetPricing: pricing("ses", 1),
      migrationEstimate: zeroEstimate,
      policy,
      policyVersion: "policy-1",
    }).type).toBe("keep");
  });

  it("replaces only when compatible risk-adjusted value clears policy", () => {
    const compatibility = createCompatibilityAssessment({
      sourceServiceId: "resend",
      targetServiceId: "postmark",
      capabilities: [exactCapability],
      catalogVersion: "email-1",
    });
    const recommendation = recommendServiceChange({
      compatibility,
      currentPricing: pricing("resend", 100),
      targetPricing: pricing("postmark", 20),
      migrationEstimate: zeroEstimate,
      policy,
      policyVersion: "policy-1",
    });
    expect(recommendation).toMatchObject({
      type: "replace",
      compatibilityStatus: "compatible",
      annualSavings: { likely: 960 },
    });
    expect(recommendation.inputSha256).toHaveLength(64);
  });

  it("keeps poor economics and investigates stale pricing", () => {
    const compatibility = createCompatibilityAssessment({
      sourceServiceId: "resend",
      targetServiceId: "postmark",
      capabilities: [exactCapability],
      catalogVersion: "email-1",
    });
    expect(recommendServiceChange({
      compatibility,
      currentPricing: pricing("resend", 30),
      targetPricing: pricing("postmark", 25),
      migrationEstimate: zeroEstimate,
      policy,
      policyVersion: "policy-1",
    }).type).toBe("keep");
    expect(recommendServiceChange({
      compatibility,
      currentPricing: pricing("resend", 100, true),
      targetPricing: pricing("postmark", 20),
      migrationEstimate: zeroEstimate,
      policy,
      policyVersion: "policy-1",
    }).type).toBe("investigate");
  });
});

describe("optimizer evaluation corpus", () => {
  it("reports precision and recall independently", () => {
    expect(evaluateLabels(
      ["transactional_send", "attachments"],
      ["transactional_send", "webhooks"],
    )).toEqual({
      version: 1,
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      precision: 0.5,
      recall: 0.5,
    });
    expect(evaluateLabels([], [])).toMatchObject({ precision: 1, recall: 1 });
  });
});

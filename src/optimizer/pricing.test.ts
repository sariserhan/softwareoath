import { describe, expect, it } from "vitest";

import {
  emailPricingCatalogV1,
  estimateEmailPricing,
} from "./pricing";
import type { OwnerUsageInputV1 } from "./types";

function usage(overrides: Partial<OwnerUsageInputV1> = {}): OwnerUsageInputV1 {
  return {
    version: 1,
    monthlyVolume: 10_000,
    currency: "USD",
    confirmedAt: "2026-08-25T00:00:00.000Z",
    confirmedBy: "owner",
    ...overrides,
  };
}

describe("optimizer O4 email pricing", () => {
  it("keeps an approved, versioned, sourced rule for every provider", () => {
    expect(emailPricingCatalogV1.reviewStatus).toBe("approved");
    expect(Object.values(emailPricingCatalogV1.providers)).toHaveLength(3);
    for (const rule of Object.values(emailPricingCatalogV1.providers)) {
      expect(rule.currency).toBe("USD");
      expect(rule.sourceUrl).toMatch(/^https:\/\//);
      expect(rule.effectiveAt).toBeTruthy();
      expect(rule.verifiedAt).toBeTruthy();
      expect(rule.pricingVersion).toBeTruthy();
      expect(rule.plans.length).toBeGreaterThan(0);
    }
  });

  it("calculates plan minimums, included usage, and bucketed overages", () => {
    expect(estimateEmailPricing({
      serviceId: "resend",
      usage: usage({ monthlyVolume: 51_000 }),
      now: "2026-08-25T00:00:00.000Z",
    }).snapshot?.monthlyCost.likely).toBe(20.9);
    expect(estimateEmailPricing({
      serviceId: "postmark",
      usage: usage({ monthlyVolume: 12_500 }),
      now: "2026-08-25T00:00:00.000Z",
    }).snapshot?.monthlyCost.likely).toBe(20.4);
  });

  it("calculates SES requests, attachment data, region, and dedicated IP", () => {
    const result = estimateEmailPricing({
      serviceId: "ses",
      usage: usage({
        region: "us-east-1",
        averageAttachmentMegabytes: 1,
        dedicatedIpRequired: true,
      }),
      now: "2026-08-25T00:00:00.000Z",
    });
    expect(result.completeness).toBe("complete");
    expect(result.snapshot).toMatchObject({
      region: "us-east-1",
      monthlyCost: { minimum: 27.12, likely: 27.12, maximum: 27.12 },
      stale: false,
    });
  });

  it("asks only for unresolved pricing inputs", () => {
    expect(estimateEmailPricing({
      serviceId: "ses",
      usage: usage({ monthlyVolume: undefined }),
    })).toEqual({
      version: 1,
      completeness: "incomplete",
      missingInputs: ["monthly email volume", "AWS region"],
    });
  });

  it("keeps owner overrides separate from canonical pricing", () => {
    const canonical = JSON.stringify(emailPricingCatalogV1);
    const result = estimateEmailPricing({
      serviceId: "resend",
      usage: usage(),
      ownerOverride: {
        version: 1,
        serviceId: "resend",
        monthlyCost: { minimum: 8, likely: 9, maximum: 10 },
        reason: "Contract invoice range.",
        confirmedAt: "2026-08-25T00:00:00.000Z",
        confirmedBy: "finance-owner",
      },
    });
    expect(result.snapshot?.monthlyCost).toEqual({ minimum: 8, likely: 9, maximum: 10 });
    expect(result.snapshot?.assumptions.join(" ")).toContain("finance-owner");
    expect(JSON.stringify(emailPricingCatalogV1)).toBe(canonical);
  });

  it("marks old snapshots stale without silently changing the amount", () => {
    const result = estimateEmailPricing({
      serviceId: "postmark",
      usage: usage(),
      now: "2027-01-01T00:00:00.000Z",
    });
    expect(result.snapshot).toMatchObject({
      monthlyCost: { likely: 15 },
      stale: true,
    });
  });

  it("refuses unreviewed catalog changes", () => {
    const result = estimateEmailPricing({
      serviceId: "resend",
      usage: usage(),
      catalog: { ...emailPricingCatalogV1, reviewStatus: "review_required" },
    });
    expect(result).toMatchObject({
      completeness: "incomplete",
      missingInputs: ["pricing catalog review"],
    });
  });

  it("does not guess an unmodeled dedicated-IP price", () => {
    expect(estimateEmailPricing({
      serviceId: "postmark",
      usage: usage({ dedicatedIpRequired: true }),
    })).toMatchObject({
      completeness: "incomplete",
      missingInputs: ["reviewed dedicated-IP price"],
    });
  });

  it("rejects invalid usage and override ranges", () => {
    expect(() => estimateEmailPricing({
      serviceId: "resend",
      usage: usage({ monthlyVolume: -1 }),
    })).toThrow(/non-negative integer/);
    expect(() => estimateEmailPricing({
      serviceId: "resend",
      usage: usage(),
      ownerOverride: {
        version: 1,
        serviceId: "resend",
        monthlyCost: { minimum: 3, likely: 2, maximum: 1 },
        reason: "Invalid test range.",
        confirmedAt: "2026-08-25T00:00:00.000Z",
        confirmedBy: "owner",
      },
    })).toThrow(/must be ordered/);
  });
});

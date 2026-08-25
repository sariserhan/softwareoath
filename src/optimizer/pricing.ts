import type {
  EmailPricingCatalogV1,
  OwnerPricingOverrideV1,
  OwnerUsageInputV1,
  PriceRangeV1,
  PricingEstimateResultV1,
  PricingPlanV1,
  ProviderPricingRuleV1,
} from "./types";

const verifiedAt = "2026-08-25T00:00:00.000Z";

export const emailPricingCatalogV1: EmailPricingCatalogV1 = {
  version: 1,
  catalogVersion: "email-pricing-2026-08-25",
  reviewStatus: "approved",
  reviewedAt: verifiedAt,
  reviewedBy: "software-oath-catalog-review",
  providers: {
    resend: {
      version: 1,
      serviceId: "resend",
      currency: "USD",
      billingModel: "plan",
      plans: [{
        id: "pro-50k",
        monthlyMinimum: 20,
        includedMonthlyUnits: 50_000,
        overageUnitSize: 1_000,
        overagePrice: 0.9,
      }],
      addOns: [{ id: "dedicated-ip", unit: "month", unitPrice: 30 }],
      sourceUrl: "https://resend.com/pricing",
      effectiveAt: "2026-08-25T00:00:00.000Z",
      verifiedAt,
      pricingVersion: "resend-2026-08-25",
      assumptions: ["Transactional email volume is billed on the Pro plan."],
      excludedCosts: [
        "Free, Scale, Enterprise, marketing-contact, and additional-domain pricing.",
        "Taxes and negotiated terms.",
      ],
    },
    ses: {
      version: 1,
      serviceId: "ses",
      currency: "USD",
      region: "owner-selected",
      billingModel: "usage",
      plans: [{
        id: "outbound",
        monthlyMinimum: 0,
        includedMonthlyUnits: 0,
        overageUnitSize: 1_000,
        overagePrice: 0.1,
      }],
      addOns: [
        { id: "attachment-data", unit: "gigabyte", unitPrice: 0.12 },
        { id: "dedicated-ip-standard", unit: "month", unitPrice: 24.95 },
      ],
      sourceUrl: "https://aws.amazon.com/ses/pricing/",
      effectiveAt: "2026-08-25T00:00:00.000Z",
      verifiedAt,
      pricingVersion: "ses-2026-08-25",
      assumptions: ["Outbound email is priced at the published base SES rate."],
      excludedCosts: [
        "EC2 data transfer, inbound Mail Manager, VDM, Global Endpoints, validation, managed IP, and AWS support.",
        "Taxes, free-tier eligibility, and negotiated terms.",
      ],
    },
    postmark: {
      version: 1,
      serviceId: "postmark",
      currency: "USD",
      billingModel: "plan",
      plans: [{
        id: "basic-10k",
        monthlyMinimum: 15,
        includedMonthlyUnits: 10_000,
        overageUnitSize: 1_000,
        overagePrice: 1.8,
      }],
      addOns: [],
      sourceUrl: "https://postmarkapp.com/pricing",
      effectiveAt: "2026-08-25T00:00:00.000Z",
      verifiedAt,
      pricingVersion: "postmark-2026-08-25",
      assumptions: ["Transactional email volume is billed on the Basic plan."],
      excludedCosts: [
        "Free developer, Pro, Platform, high-volume, dedicated-IP, and negotiated pricing.",
        "Taxes.",
      ],
    },
  },
};

function exactRange(value: number): PriceRangeV1 {
  const rounded = Math.round(value * 100) / 100;
  return { minimum: rounded, likely: rounded, maximum: rounded };
}

function planCost(plan: PricingPlanV1, monthlyVolume: number): number {
  if (plan.maximumMonthlyUnits !== undefined && monthlyVolume > plan.maximumMonthlyUnits) {
    throw new Error(`Monthly volume exceeds plan ${plan.id}.`);
  }
  const overage = Math.max(0, monthlyVolume - plan.includedMonthlyUnits);
  return plan.monthlyMinimum +
    Math.ceil(overage / plan.overageUnitSize) * plan.overagePrice;
}

function isStale(rule: ProviderPricingRuleV1, now: string, staleAfterDays: number): boolean {
  const age = Date.parse(now) - Date.parse(rule.verifiedAt);
  return !Number.isFinite(age) || age > staleAfterDays * 86_400_000;
}

export function estimateEmailPricing(options: {
  serviceId: ProviderPricingRuleV1["serviceId"];
  usage: OwnerUsageInputV1;
  ownerOverride?: OwnerPricingOverrideV1;
  catalog?: EmailPricingCatalogV1;
  now?: string;
  staleAfterDays?: number;
}): PricingEstimateResultV1 {
  const catalog = options.catalog ?? emailPricingCatalogV1;
  const rule = catalog.providers[options.serviceId];
  const now = options.now ?? new Date().toISOString();
  const missingInputs: string[] = [];
  if (catalog.reviewStatus !== "approved") missingInputs.push("pricing catalog review");
  if (options.usage.currency !== rule.currency) missingInputs.push("USD usage currency");
  if (options.usage.monthlyVolume === undefined) missingInputs.push("monthly email volume");
  if (options.serviceId === "ses" && !options.usage.region) missingInputs.push("AWS region");
  if (options.usage.monthlyVolume !== undefined &&
    (!Number.isInteger(options.usage.monthlyVolume) || options.usage.monthlyVolume < 0)) {
    throw new Error("Monthly email volume must be a non-negative integer.");
  }
  if (options.usage.averageAttachmentMegabytes !== undefined &&
    (!Number.isFinite(options.usage.averageAttachmentMegabytes) ||
      options.usage.averageAttachmentMegabytes < 0)) {
    throw new Error("Average attachment size must be non-negative.");
  }
  if (options.ownerOverride &&
    !(options.ownerOverride.monthlyCost.minimum <= options.ownerOverride.monthlyCost.likely &&
      options.ownerOverride.monthlyCost.likely <= options.ownerOverride.monthlyCost.maximum)) {
    throw new Error("Owner pricing override range must be ordered.");
  }
  if (options.ownerOverride && options.ownerOverride.serviceId !== options.serviceId) {
    throw new Error("Owner pricing override service does not match the estimate target.");
  }
  if (missingInputs.length) {
    return { version: 1, completeness: "incomplete", missingInputs };
  }

  let monthlyCost: PriceRangeV1;
  const assumptions = [...rule.assumptions];
  if (options.ownerOverride) {
    monthlyCost = options.ownerOverride.monthlyCost;
    assumptions.push(
      `Owner pricing override confirmed by ${options.ownerOverride.confirmedBy}: ${options.ownerOverride.reason}`,
    );
  } else {
    const monthlyVolume = options.usage.monthlyVolume!;
    let amount = planCost(rule.plans[0], monthlyVolume);
    if (options.serviceId === "ses") {
      const attachmentGb = monthlyVolume *
        (options.usage.averageAttachmentMegabytes ?? 0) / 1_024;
      amount += attachmentGb *
        (rule.addOns.find((item) => item.id === "attachment-data")?.unitPrice ?? 0);
    }
    if (options.usage.dedicatedIpRequired) {
      const dedicated = rule.addOns.find((item) => item.id.includes("dedicated-ip"));
      if (!dedicated) {
        return {
          version: 1,
          completeness: "incomplete",
          missingInputs: ["reviewed dedicated-IP price"],
        };
      }
      amount += dedicated.unitPrice;
    }
    monthlyCost = exactRange(amount);
  }

  return {
    version: 1,
    completeness: "complete",
    missingInputs: [],
    snapshot: {
      version: 1,
      serviceId: options.serviceId,
      currency: rule.currency,
      region: options.usage.region,
      monthlyCost,
      sourceUrl: rule.sourceUrl,
      effectiveAt: rule.effectiveAt,
      verifiedAt: rule.verifiedAt,
      pricingVersion: rule.pricingVersion,
      assumptions,
      excludedCosts: [...rule.excludedCosts],
      stale: isStale(rule, now, options.staleAfterDays ?? 90),
    },
  };
}

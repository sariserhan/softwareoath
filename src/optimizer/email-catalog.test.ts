import { describe, expect, it } from "vitest";

import {
  assessEmailCompatibility,
  emailCompatibilityCatalogV1,
  type EmailCapabilityId,
  type EmailTargetServiceId,
} from "./email-catalog";
import type {
  CapabilityEvidenceV1,
  CapabilityRequirement,
} from "./types";

function observed(
  capabilityId: string,
  requirement: CapabilityRequirement = "required",
): CapabilityEvidenceV1 {
  return {
    version: 1,
    serviceId: "resend",
    capabilityId,
    requirement,
    confidence: "very_high",
    ownerConfirmed: false,
    evidence: [{
      version: 1,
      provenance: "observed",
      confidence: "very_high",
      file: "src/email.ts",
      lineStart: 1,
      reason: "Fixture evidence.",
    }],
  };
}

function assess(
  targetServiceId: EmailTargetServiceId,
  capabilityIds: string[],
) {
  return assessEmailCompatibility({
    targetServiceId,
    capabilities: capabilityIds.map((id) => observed(id)),
  });
}

describe("email compatibility catalog", () => {
  it("versions and sources every capability for SES and Postmark", () => {
    const expected: EmailCapabilityId[] = [
      "transactional_send",
      "html_email",
      "text_email",
      "attachments",
      "provider_templates",
      "batch_send",
      "scheduled_send",
      "message_tags",
      "idempotency",
      "delivery_webhooks",
      "inbound_email",
      "contacts_audiences",
      "sending_domains",
    ];
    expect(emailCompatibilityCatalogV1).toMatchObject({
      version: 1,
      catalogVersion: "email-2026-08-24",
      verifiedAt: "2026-08-24T00:00:00.000Z",
    });
    for (const provider of Object.values(emailCompatibilityCatalogV1.providers)) {
      expect(Object.keys(provider.capabilities).sort()).toEqual(
        [...expected].sort(),
      );
      for (const definition of Object.values(provider.capabilities)) {
        expect(definition.sourceUrls.length).toBeGreaterThan(0);
        expect(definition.sourceUrls.every(
          (url) => url.startsWith("https://"),
        )).toBe(true);
      }
      expect(provider.operationalDifferences.length).toBeGreaterThanOrEqual(4);
      expect(provider.unresolvedOwnerInputs.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("returns exact compatibility for simple HTML transactional sending", () => {
    for (const target of ["ses", "postmark"] as const) {
      const result = assess(target, ["transactional_send", "html_email"]);
      expect(result.status).toBe("compatible");
      expect(result.semanticDifferences).toEqual([]);
      expect(result.catalogSources?.length).toBeGreaterThan(0);
      expect(result.catalogVerifiedAt).toBe(
        emailCompatibilityCatalogV1.verifiedAt,
      );
      expect(result.unknowns).toEqual(expect.arrayContaining([
        expect.stringContaining("Owner input required:"),
      ]));
    }
  });

  it("exposes migration changes instead of hiding them in a percentage", () => {
    for (const target of ["ses", "postmark"] as const) {
      const result = assess(target, [
        "transactional_send",
        "attachments",
        "provider_templates",
        "batch_send",
        "delivery_webhooks",
        "inbound_email",
        "sending_domains",
      ]);
      expect(result.status).toBe("compatible_with_changes");
      expect(result.capabilities.filter(
        (item) => item.support === "supported_with_changes",
      )).toHaveLength(6);
      expect(result.semanticDifferences).toEqual(expect.arrayContaining([
        expect.stringContaining("attachments:"),
        expect.stringContaining("delivery_webhooks:"),
        expect.stringContaining("inbound_email:"),
      ]));
      expect(result.operationalDifferences.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("blocks native scheduling and idempotency for both targets", () => {
    for (const target of ["ses", "postmark"] as const) {
      const result = assess(target, [
        "transactional_send",
        "scheduled_send",
        "idempotency",
      ]);
      expect(result.status).toBe("incompatible");
      expect(result.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "scheduled_send",
          support: "unsupported",
        }),
        expect.objectContaining({
          capabilityId: "idempotency",
          support: "unsupported",
        }),
      ]));
    }
  });

  it("distinguishes SES contact-list changes from unsupported Postmark audiences", () => {
    expect(assess("ses", [
      "transactional_send",
      "contacts_audiences",
    ]).status).toBe("compatible_with_changes");
    expect(assess("postmark", [
      "transactional_send",
      "contacts_audiences",
    ])).toMatchObject({
      status: "incompatible",
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "contacts_audiences",
          support: "unsupported",
        }),
      ]),
    });
  });

  it("makes unknown capabilities unverified and keeps optional gaps non-blocking", () => {
    expect(assess("ses", [
      "transactional_send",
      "future_dynamic_capability",
    ])).toMatchObject({
      status: "unverified",
      unknowns: expect.arrayContaining([
        "Catalog support is unverified for future_dynamic_capability.",
      ]),
    });
    const optionalSchedule = assessEmailCompatibility({
      targetServiceId: "postmark",
      capabilities: [
        observed("transactional_send"),
        observed("scheduled_send", "optional"),
      ],
    });
    expect(optionalSchedule.status).toBe("compatible");
    expect(optionalSchedule.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: "scheduled_send",
        requirement: "optional",
        support: "unsupported",
      }),
    ]));
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  sentryIncidentFromWebhook,
  verifySentrySignature,
} from "./sentry";

describe("Sentry integration", () => {
  it("verifies the signature against the untouched request body", () => {
    const body = '{"action":"created"}';
    const signature = createHmac("sha256", "secret")
      .update(body)
      .digest("hex");

    expect(verifySentrySignature(body, signature, "secret")).toBe(true);
    expect(verifySentrySignature(`${body}\n`, signature, "secret")).toBe(false);
  });

  it("normalizes an issue webhook into an incident and run", () => {
    const raw = JSON.stringify({
      action: "created",
      data: {
        issue: {
          id: "42",
          title: "Checkout crashed",
          status: "unresolved",
          priority: "high",
          web_url: "https://sentry.example/issues/42",
          project: { slug: "storefront" },
        },
      },
    });

    const result = sentryIncidentFromWebhook(
      raw,
      new Date("2026-07-30T10:00:00Z"),
    );

    expect(result.incident).toMatchObject({
      externalId: "42",
      title: "Checkout crashed",
      project: "storefront",
      source: "sentry",
    });
    expect(result.run.status).toBe("received");
    expect(result.run.incidentId).toBe(result.incident.id);
  });
});

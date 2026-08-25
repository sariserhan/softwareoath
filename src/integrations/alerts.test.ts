import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  genericIncidentFromWebhook,
  verifyGenericWebhookSignature,
} from "./alerts.js";

describe("generic webhook alert ingestion", () => {
  it("verifies hmac sha256 webhook signatures", () => {
    const rawBody = JSON.stringify({ title: "High CPU", id: "alert-123" });
    const secret = "topsecret";
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

    expect(verifyGenericWebhookSignature(rawBody, signature, secret)).toBe(true);
    expect(verifyGenericWebhookSignature(rawBody, "invalid", secret)).toBe(false);
  });

  it("normalizes generic alert payload into an incident and run record", () => {
    const rawBody = JSON.stringify({
      id: "pd-456",
      source: "pagerduty",
      title: "Database connection pool exhausted",
      repository: "softwareoath/storefront",
      severity: "critical",
      commit: "abc1234",
    });

    const { incident, run } = genericIncidentFromWebhook(rawBody);

    expect(incident.externalId).toBe("pd-456");
    expect(incident.source).toBe("pagerduty");
    expect(incident.title).toBe("Database connection pool exhausted");
    expect(incident.priority).toBe("critical");
    expect(run.repository).toBe("softwareoath/storefront");
    expect(run.commit).toBe("abc1234");
  });

  it("uses the payload digest to deduplicate providers without event ids", () => {
    const rawBody = JSON.stringify({ title: "High CPU", repository: "acme/api" });
    const first = genericIncidentFromWebhook(rawBody);
    const replay = genericIncidentFromWebhook(rawBody);

    expect(first.incident.externalId).toBe("sha256:" + first.incident.payloadDigest);
    expect(replay.incident.externalId).toBe(first.incident.externalId);
  });
});

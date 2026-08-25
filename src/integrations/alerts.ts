import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  HostedRunRecord,
  IncidentRecord,
} from "../control-plane/types.js";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyGenericWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const normalizedSig = signature.replace(/^sha256=/i, "");
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(expected, normalizedSig);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function genericIncidentFromWebhook(
  rawBody: string,
  receivedAt = new Date(),
  defaultRepository = "unmapped",
): { incident: IncidentRecord; run: HostedRunRecord } {
  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const timestamp = receivedAt.toISOString();

  // Support PagerDuty, Datadog, Prometheus, Grafana, GitHub, or standard JSON
  const externalId =
    text(payload.id) ??
    text(payload.externalId) ??
    text(payload.incident_id) ??
    text(payload.alert_id) ??
    text((payload.event as Record<string, unknown>)?.id) ??
    randomUUID();

  const title =
    text(payload.title) ??
    text(payload.summary) ??
    text(payload.message) ??
    text((payload.event as Record<string, unknown>)?.title) ??
    text((payload.incident as Record<string, unknown>)?.title) ??
    `Generic Alert ${externalId}`;

  const repository =
    text(payload.repository) ??
    text(payload.repo) ??
    text((payload.repository as Record<string, unknown>)?.full_name) ??
    defaultRepository;

  const status =
    text(payload.status) ??
    text(payload.state) ??
    text((payload.incident as Record<string, unknown>)?.status) ??
    "triggered";

  const priority =
    text(payload.priority) ??
    text(payload.severity) ??
    text(payload.level) ??
    "high";

  const url =
    text(payload.url) ??
    text(payload.html_url) ??
    text(payload.link);

  const incidentId = `INC-${randomUUID()}`;

  const incident: IncidentRecord = {
    id: incidentId,
    source: text(payload.source) ?? "generic-webhook",
    externalId,
    title,
    status,
    priority,
    url,
    project: text(payload.project),
    release: text(payload.release) ?? text(payload.commit),
    receivedAt: timestamp,
    payloadDigest: createHash("sha256").update(rawBody).digest("hex"),
  };

  return {
    incident,
    run: {
      id: `RUN-${randomUUID()}`,
      incidentId,
      repository,
      commit: incident.release,
      status: "received",
      attempts: 0,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

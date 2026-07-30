import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  HostedRunRecord,
  IncidentRecord,
} from "../control-plane/types";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifySentrySignature(
  rawBody: string,
  signature: string | undefined,
  clientSecret: string,
): boolean {
  if (!signature || !clientSecret) return false;
  const expected = createHmac("sha256", clientSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(expected, signature);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function sentryIncidentFromWebhook(
  rawBody: string,
  receivedAt = new Date(),
  repository = "unmapped",
): { incident: IncidentRecord; run: HostedRunRecord } {
  const payload = JSON.parse(rawBody) as {
    action?: unknown;
    data?: {
      issue?: Record<string, unknown>;
      event?: Record<string, unknown>;
    };
  };
  const issue = payload.data?.issue ?? {};
  const event = payload.data?.event ?? {};
  const externalId =
    text(issue.id) ?? text(event.issue_id) ?? text(event.event_id);
  if (!externalId) throw new Error("Sentry webhook has no issue or event id.");
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const metadataTitle = [text(metadata.type), text(metadata.value)]
    .filter(Boolean)
    .join(": ");
  const issueProject = issue.project as Record<string, unknown> | undefined;
  const timestamp = receivedAt.toISOString();
  const incidentId = `INC-${randomUUID()}`;
  const incident: IncidentRecord = {
    id: incidentId,
    source: "sentry",
    externalId,
    title:
      text(issue.title) ??
      (metadataTitle || `Sentry issue ${externalId}`),
    status: text(issue.status) ?? text(payload.action) ?? "triggered",
    priority: text(issue.priority) ?? text(event.level),
    url: text(issue.web_url) ?? text(event.web_url),
    project:
      text(issueProject?.slug) ??
      text(issueProject?.name) ??
      (typeof event.project === "number" ? String(event.project) : undefined),
    release: text(event.release),
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
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

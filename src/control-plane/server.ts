import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  sentryIncidentFromWebhook,
  verifySentrySignature,
} from "../integrations/sentry";
import { FileControlPlaneStore } from "./store";

async function body(request: IncomingMessage): Promise<string> {
  let value = "";
  for await (const chunk of request) {
    value += chunk.toString();
    if (value.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return value;
}

function json(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (process.env.SOFTWARE_OATH_DASHBOARD_ORIGIN) {
    headers["Access-Control-Allow-Origin"] =
      process.env.SOFTWARE_OATH_DASHBOARD_ORIGIN;
  }
  response.writeHead(status, headers);
  response.end(`${JSON.stringify(payload)}\n`);
}

export function createControlPlaneServer(options: {
  store: FileControlPlaneStore;
  sentrySecret: string;
  approvalToken: string;
  defaultRepository?: string;
}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/runs") {
        json(response, 200, { runs: await options.store.listRuns() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/webhooks/sentry") {
        const rawBody = await body(request);
        const signature = request.headers["sentry-hook-signature"];
        if (
          !verifySentrySignature(
            rawBody,
            Array.isArray(signature) ? signature[0] : signature,
            options.sentrySecret,
          )
        ) {
          json(response, 401, { error: "Invalid Sentry signature." });
          return;
        }
        const parsed = sentryIncidentFromWebhook(
          rawBody,
          new Date(),
          options.defaultRepository,
        );
        const stored = await options.store.addIncident(
          parsed.incident,
          parsed.run,
        );
        json(response, stored.duplicate ? 200 : 202, stored);
        return;
      }
      const approvalMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/decision$/);
      if (request.method === "POST" && approvalMatch) {
        if (
          !options.approvalToken ||
          request.headers.authorization !== `Bearer ${options.approvalToken}`
        ) {
          json(response, 401, { error: "Approval authorization required." });
          return;
        }
        const payload = JSON.parse(await body(request)) as {
          decision?: unknown;
          actor?: unknown;
          reason?: unknown;
        };
        if (!["approved", "rejected"].includes(String(payload.decision))) {
          json(response, 400, { error: "Invalid decision." });
          return;
        }
        const actor = String(payload.actor ?? "").trim();
        const reason = String(payload.reason ?? "").trim();
        if (!actor || !reason) {
          json(response, 400, { error: "Actor and reason are required." });
          return;
        }
        const run = await options.store.decide({
          id: `APPROVAL-${randomUUID()}`,
          runId: decodeURIComponent(approvalMatch[1]),
          decision: payload.decision as "approved" | "rejected",
          actor,
          reason,
          createdAt: new Date().toISOString(),
        });
        json(response, 200, { run });
        return;
      }
      json(response, 404, { error: "Not found." });
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

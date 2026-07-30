import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";

import {
  sentryIncidentFromWebhook,
  verifySentrySignature,
} from "../integrations/sentry";
import type { ControlPlaneStore } from "./types";

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
  store: ControlPlaneStore;
  sentrySecret: string;
  approvalToken: string;
  defaultRepository?: string;
  staticDirectory?: string;
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
      const logsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/logs$/);
      if (request.method === "GET" && logsMatch) {
        json(response, 200, {
          logs: await options.store.listLogs(decodeURIComponent(logsMatch[1])),
        });
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
        const mapping = parsed.incident.project
          ? await options.store.findMapping(parsed.incident.project)
          : undefined;
        if (mapping) parsed.run.repository = mapping.repository;
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
      const cancellationMatch = url.pathname.match(
        /^\/api\/runs\/([^/]+)\/cancel$/,
      );
      if (request.method === "POST" && cancellationMatch) {
        if (
          !options.approvalToken ||
          request.headers.authorization !== `Bearer ${options.approvalToken}`
        ) {
          json(response, 401, { error: "Operator authorization required." });
          return;
        }
        const run = await options.store.requestCancellation(
          decodeURIComponent(cancellationMatch[1]),
        );
        json(response, 202, { run });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/mappings") {
        if (
          !options.approvalToken ||
          request.headers.authorization !== `Bearer ${options.approvalToken}`
        ) {
          json(response, 401, { error: "Operator authorization required." });
          return;
        }
        const payload = JSON.parse(await body(request)) as {
          sentryProject?: unknown;
          repository?: unknown;
          cloneUrl?: unknown;
          defaultBranch?: unknown;
          installationId?: unknown;
          localPath?: unknown;
        };
        const sentryProject = String(payload.sentryProject ?? "").trim();
        const repository = String(payload.repository ?? "").trim();
        const cloneUrl = String(payload.cloneUrl ?? "").trim();
        const defaultBranch = String(payload.defaultBranch ?? "main").trim();
        if (!sentryProject || !repository || !cloneUrl) {
          json(response, 400, {
            error: "sentryProject, repository, and cloneUrl are required.",
          });
          return;
        }
        const now = new Date().toISOString();
        const mapping = await options.store.upsertMapping({
          id: `MAPPING-${randomUUID()}`,
          sentryProject,
          repository,
          cloneUrl,
          defaultBranch,
          installationId:
            typeof payload.installationId === "number"
              ? payload.installationId
              : undefined,
          localPath:
            typeof payload.localPath === "string" && payload.localPath
              ? payload.localPath
              : undefined,
          createdAt: now,
          updatedAt: now,
        });
        json(response, 200, { mapping });
        return;
      }
      if (
        request.method === "GET" &&
        options.staticDirectory &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/webhooks/")
      ) {
        const staticRoot = resolve(options.staticDirectory);
        const requestedPath =
          url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
        const filePath = resolve(staticRoot, requestedPath);
        if (!filePath.startsWith(`${staticRoot}/`) && filePath !== staticRoot) {
          json(response, 400, { error: "Invalid static path." });
          return;
        }
        try {
          const content = await readFile(filePath);
          const contentType =
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".svg": "image/svg+xml",
              ".png": "image/png",
            }[extname(filePath)] ?? "application/octet-stream";
          response.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": extname(filePath) === ".html"
              ? "no-cache"
              : "public, max-age=31536000, immutable",
          });
          response.end(content);
          return;
        } catch {
          // Continue to the JSON 404 response.
        }
      }
      json(response, 404, { error: "Not found." });
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

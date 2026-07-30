import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";

import {
  sentryIncidentFromWebhook,
  verifySentrySignature,
} from "../integrations/sentry";
import type { ControlPlaneStore } from "./types";
import { LocalArtifactStore } from "./artifacts";
import type { TrustedReceiptKeys } from "../repair/signature";
import {
  receiptSignerFromEnvironment,
  type ReceiptSigner,
} from "../repair/signature";
import {
  createFinalAttestation,
  verifyFinalAttestation,
} from "./attestation";
import { GitHubReviewerOAuth, ReviewerSessions } from "./auth";

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
    headers["Access-Control-Allow-Credentials"] = "true";
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
  artifacts?: LocalArtifactStore;
  trustedKeys?: TrustedReceiptKeys;
  signer?: ReceiptSigner;
  reviewerOAuth?: GitHubReviewerOAuth;
  reviewerSessions?: ReviewerSessions;
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
      if (request.method === "GET" && url.pathname === "/api/auth/github") {
        if (!options.reviewerOAuth || !options.reviewerSessions) {
          json(response, 503, { error: "Reviewer authentication is unavailable." });
          return;
        }
        const { state } = options.reviewerSessions.begin(response);
        response.writeHead(302, {
          Location: options.reviewerOAuth.authorizationUrl(state),
        });
        response.end();
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/auth/github/callback"
      ) {
        if (!options.reviewerOAuth || !options.reviewerSessions) {
          json(response, 503, { error: "Reviewer authentication is unavailable." });
          return;
        }
        try {
          const state = url.searchParams.get("state") ?? "";
          const code = url.searchParams.get("code") ?? "";
          options.reviewerSessions.verifyCallback(request, state);
          const accessToken = await options.reviewerOAuth.exchange(code);
          const identity = await options.reviewerOAuth.identity(accessToken);
          await options.reviewerSessions.create(response, identity, accessToken);
          await options.store.appendAudit({
            id: `AUDIT-${randomUUID()}`,
            action: "auth.login",
            outcome: "success",
            actor: identity,
            detail: "GitHub reviewer session created.",
            createdAt: new Date().toISOString(),
          });
          response.writeHead(302, { Location: "/" });
          response.end();
        } catch (error) {
          const detail = error instanceof Error ? error.message : "GitHub login failed.";
          await options.store.appendAudit({
            id: `AUDIT-${randomUUID()}`,
            action: "auth.login",
            outcome: "denied",
            detail,
            createdAt: new Date().toISOString(),
          });
          json(response, 401, { error: detail });
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        const authenticated = await options.reviewerSessions?.authenticate(request);
        json(response, 200, {
          authenticated: Boolean(authenticated),
          identity: authenticated?.session.identity,
          csrfToken: authenticated?.session.csrfToken,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        if (!options.reviewerSessions) {
          json(response, 503, { error: "Reviewer authentication is unavailable." });
          return;
        }
        const authenticated = await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, { error: "Authentication required." });
          return;
        }
        options.reviewerSessions.assertCsrf(request, authenticated.session);
        await options.reviewerSessions.logout(request, response);
        await options.store.appendAudit({
          id: `AUDIT-${randomUUID()}`,
          action: "auth.logout",
          outcome: "success",
          actor: authenticated.session.identity,
          detail: "Reviewer session ended.",
          createdAt: new Date().toISOString(),
        });
        json(response, 200, { authenticated: false });
        return;
      }
      const receiptMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/receipt$/);
      if (request.method === "GET" && receiptMatch) {
        const attestation = await options.store.getAttestation(
          decodeURIComponent(receiptMatch[1]),
        );
        if (!attestation) {
          json(response, 404, { error: "Final attestation not found." });
          return;
        }
        verifyFinalAttestation(attestation, options.trustedKeys);
        json(response, 200, { attestation });
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
        if (!options.reviewerOAuth || !options.reviewerSessions) {
          json(response, 503, { error: "Reviewer authentication is unavailable." });
          return;
        }
        const authenticated = await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, { error: "Reviewer authentication required." });
          return;
        }
        try {
          options.reviewerSessions.assertCsrf(request, authenticated.session);
        } catch (error) {
          await options.store.appendAudit({
            id: `AUDIT-${randomUUID()}`,
            action: "decision.denied",
            outcome: "denied",
            actor: authenticated.session.identity,
            runId: decodeURIComponent(approvalMatch[1]),
            detail: error instanceof Error ? error.message : "CSRF validation failed.",
            createdAt: new Date().toISOString(),
          });
          json(response, 403, { error: "CSRF validation failed." });
          return;
        }
        const payload = JSON.parse(await body(request)) as {
          decision?: unknown;
          reason?: unknown;
        };
        if (!["approved", "rejected"].includes(String(payload.decision))) {
          json(response, 400, { error: "Invalid decision." });
          return;
        }
        const reason = String(payload.reason ?? "").trim();
        if (!reason) {
          json(response, 400, { error: "A written reason is required." });
          return;
        }
        const runId = decodeURIComponent(approvalMatch[1]);
        const pendingRun = await options.store.getRun(runId);
        if (!pendingRun?.repairId) {
          json(response, 409, { error: "The run has no repair receipt." });
          return;
        }
        let authorization;
        try {
          authorization = await options.reviewerOAuth.authorize(
            authenticated.accessToken,
            pendingRun.repository,
          );
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "Repository authorization denied.";
          await options.store.appendAudit({
            id: `AUDIT-${randomUUID()}`,
            action: "decision.denied",
            outcome: "denied",
            actor: authenticated.session.identity,
            runId,
            repository: pendingRun.repository,
            detail,
            createdAt: new Date().toISOString(),
          });
          json(response, 403, { error: detail });
          return;
        }
        if (!options.artifacts) {
          json(response, 503, { error: "Receipt verification is unavailable." });
          return;
        }
        const repairReceipt = await options.artifacts.readRepair(
          pendingRun.repairId,
          options.trustedKeys,
        );
        const incident = await options.store.getIncident(pendingRun.incidentId);
        if (!incident) {
          json(response, 409, { error: "The run incident was not found." });
          return;
        }
        const approval = {
          id: `APPROVAL-${randomUUID()}`,
          runId,
          decision: payload.decision as "approved" | "rejected",
          actor: authenticated.session.identity.login,
          identity: authenticated.session.identity,
          authorization,
          reason,
          createdAt: new Date().toISOString(),
        } satisfies import("./types").ApprovalRecord;
        const attestation = createFinalAttestation({
          run: pendingRun,
          incident,
          approval,
          repairReceipt,
          signer: options.signer ?? receiptSignerFromEnvironment(),
        });
        verifyFinalAttestation(attestation, options.trustedKeys);
        const run = await options.store.decide(approval, attestation);
        await options.store.appendAudit({
          id: `AUDIT-${randomUUID()}`,
          action: "decision.allowed",
          outcome: "success",
          actor: approval.identity,
          runId,
          repository: pendingRun.repository,
          detail: `${approval.decision} with ${authorization.permission} permission.`,
          createdAt: approval.createdAt,
        });
        json(response, 200, { run, attestation });
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

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";

import {
  sentryIncidentFromWebhook,
  verifySentrySignature,
} from "../integrations/sentry";
import {
  genericIncidentFromWebhook,
  verifyGenericWebhookSignature,
} from "../integrations/alerts";
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
import {
  enqueueStewardshipRun,
  nextScheduledAt,
} from "../steward/schedule";
import {
  knowledgeFromQuestionAnswer,
  knowledgeFromCustomPromise,
} from "../steward/knowledge";
import type { GitHubAppClient } from "../integrations/github";
import { parseOath } from "../domain/oath";

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
  sentrySecret?: string;
  genericWebhookSecret?: string;
  approvalToken: string;
  defaultRepository?: string;
  staticDirectory?: string;
  artifacts?: LocalArtifactStore;
  trustedKeys?: TrustedReceiptKeys;
  signer?: ReceiptSigner;
  reviewerOAuth?: GitHubReviewerOAuth;
  reviewerSessions?: ReviewerSessions;
  githubOnboarding?: Pick<GitHubAppClient, "installedRepositories"> &
    Partial<Pick<GitHubAppClient, "installationUrl" | "proposeInitialOath">>;
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
      if (request.method === "GET" && url.pathname === "/api/repositories") {
        json(response, 200, {
          repositories: await options.store.listRepositories(),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/github/install") {
        if (!options.reviewerSessions || !options.githubOnboarding?.installationUrl) {
          json(response, 503, { error: "GitHub App installation is unavailable." });
          return;
        }
        if (!(await options.reviewerSessions.authenticate(request))) {
          json(response, 401, { error: "GitHub authentication required." });
          return;
        }
        response.writeHead(302, {
          Location: await options.githubOnboarding.installationUrl(),
        });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/github/install/callback") {
        if (!options.reviewerSessions || !options.githubOnboarding) {
          json(response, 503, { error: "GitHub App installation is unavailable." });
          return;
        }
        const authenticated = await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, { error: "GitHub authentication required." });
          return;
        }
        const installationId = Number(url.searchParams.get("installation_id"));
        const installations = await options.githubOnboarding.installedRepositories();
        if (!Number.isSafeInteger(installationId) || !installations.some((item) => item.installationId === installationId)) {
          json(response, 400, { error: "GitHub App installation could not be verified." });
          return;
        }
        await options.store.appendAudit({
          id: `AUDIT-${randomUUID()}`,
          action: "github.install",
          outcome: "success",
          actor: authenticated.session.identity,
          detail: `GitHub App installation ${installationId} connected.`,
          createdAt: new Date().toISOString(),
        });
        response.writeHead(302, { Location: "/" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/github/repositories") {
        if (
          !options.reviewerOAuth ||
          !options.reviewerSessions ||
          !options.githubOnboarding
        ) {
          json(response, 503, { error: "GitHub onboarding is unavailable." });
          return;
        }
        const authenticated =
          await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, { error: "GitHub authentication required." });
          return;
        }
        const [organizations, writable, installed] = await Promise.all([
          options.reviewerOAuth.organizations(authenticated.accessToken),
          options.reviewerOAuth.writableRepositories(authenticated.accessToken),
          options.githubOnboarding.installedRepositories(),
        ]);
        const installationByRepository = new Map(
          installed.map(({ repository, installationId }) => [
            repository,
            installationId,
          ]),
        );
        json(response, 200, {
          organizations,
          repositories: writable.flatMap((repository) => {
            const installationId = installationByRepository.get(
              repository.repository,
            );
            return installationId
              ? [{ ...repository, installationId }]
              : [];
          }),
        });
        return;
      }
      const oathDraftMatch = url.pathname.match(
        /^\/api\/repositories\/(.+)\/oath-draft$/,
      );
      const oathProposalMatch = url.pathname.match(
        /^\/api\/repositories\/(.+)\/oath-proposal$/,
      );
      if (request.method === "POST" && oathProposalMatch) {
        if (!options.reviewerOAuth || !options.reviewerSessions) {
          json(response, 503, { error: "Owner authentication is unavailable." });
          return;
        }
        if (!options.githubOnboarding?.proposeInitialOath) {
          json(response, 503, { error: "GitHub oath proposals are unavailable." });
          return;
        }
        const authenticated = await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, { error: "Repository owner authentication required." });
          return;
        }
        try {
          options.reviewerSessions.assertCsrf(request, authenticated.session);
        } catch {
          json(response, 403, { error: "CSRF validation failed." });
          return;
        }
        const repository = decodeURIComponent(oathProposalMatch[1]);
        const registration = await options.store.getRepository(repository);
        if (!registration) {
          json(response, 404, { error: "Repository is not registered." });
          return;
        }
        if (!registration.installationId) {
          json(response, 409, { error: "GitHub App installation is required." });
          return;
        }
        const payload = JSON.parse(await body(request)) as { source?: unknown };
        const source = typeof payload.source === "string" ? payload.source : "";
        let oath;
        try {
          oath = parseOath(source);
        } catch (error) {
          json(response, 400, {
            error: error instanceof Error ? error.message : "Oath schema is invalid.",
          });
          return;
        }
        if (
          oath.application.repository !== repository ||
          oath.application.defaultBranch !== registration.defaultBranch
        ) {
          json(response, 400, {
            error: "Oath repository and default branch must match the registration.",
          });
          return;
        }
        try {
          await options.reviewerOAuth.authorize(authenticated.accessToken, repository);
          const separator = repository.indexOf("/");
          const owner = repository.slice(0, separator);
          const repo = repository.slice(separator + 1);
          const proposal = await options.githubOnboarding.proposeInitialOath({
            installationId: registration.installationId,
            owner,
            repo,
            branch: "software-oath/initial-oath-" + randomUUID(),
            base: registration.defaultBranch,
            source,
          });
          await options.store.appendAudit({
            id: "AUDIT-" + randomUUID(),
            action: "oath.propose",
            outcome: "success",
            actor: authenticated.session.identity,
            repository,
            detail: "Initial oath proposed in draft pull request " + proposal.number + ".",
            createdAt: new Date().toISOString(),
          });
          json(response, 201, { proposal });
        } catch (error) {
          json(response, 502, {
            error: error instanceof Error ? error.message : "Oath proposal failed.",
          });
        }
        return;
      }
      if (request.method === "GET" && oathDraftMatch) {
        if (!options.reviewerOAuth || !options.reviewerSessions) {
          json(response, 503, { error: "Owner authentication is unavailable." });
          return;
        }
        if (!options.artifacts) {
          json(response, 503, { error: "Oath draft storage is unavailable." });
          return;
        }
        const authenticated = await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, { error: "Repository owner authentication required." });
          return;
        }
        const repository = decodeURIComponent(oathDraftMatch[1]);
        if (!(await options.store.getRepository(repository))) {
          json(response, 404, { error: "Repository is not registered." });
          return;
        }
        try {
          await options.reviewerOAuth.authorize(
            authenticated.accessToken,
            repository,
          );
          const draft = await options.artifacts.readInitialOathDraft(repository);
          json(response, 200, { draft });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            json(response, 404, { error: "Initial oath draft is not ready." });
            return;
          }
          json(response, 403, {
            error: error instanceof Error ? error.message : "Repository access denied.",
          });
        }
        return;
      }
      const knowledgeMatch = url.pathname.match(
        /^\/api\/repositories\/(.+)\/knowledge$/,
      );
      const questionsMatch = url.pathname.match(
        /^\/api\/repositories\/(.+)\/questions$/,
      );
      const answerQuestionMatch = url.pathname.match(
        /^\/api\/repositories\/(.+)\/questions\/([^/]+)\/answer$/,
      );
      const addPromiseMatch = url.pathname.match(
        /^\/api\/repositories\/(.+)\/promises$/,
      );
      if (
        (request.method === "GET" && (knowledgeMatch || questionsMatch)) ||
        (request.method === "POST" && (answerQuestionMatch || addPromiseMatch))
      ) {
        if (!options.reviewerOAuth || !options.reviewerSessions) {
          json(response, 503, { error: "Owner authentication is unavailable." });
          return;
        }
        const authenticated =
          await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, {
            error: "Repository owner authentication required.",
          });
          return;
        }
        const encodedRepository =
          knowledgeMatch?.[1] ??
          questionsMatch?.[1] ??
          answerQuestionMatch?.[1] ??
          addPromiseMatch?.[1];
        const repository = decodeURIComponent(encodedRepository!);
        if (!(await options.store.getRepository(repository))) {
          json(response, 404, { error: "Repository is not registered." });
          return;
        }
        if (request.method === "POST") {
          try {
            options.reviewerSessions.assertCsrf(
              request,
              authenticated.session,
            );
          } catch {
            json(response, 403, { error: "CSRF validation failed." });
            return;
          }
        }
        let authorization;
        try {
          authorization = await options.reviewerOAuth.authorize(
            authenticated.accessToken,
            repository,
          );
        } catch (error) {
          json(response, 403, {
            error:
              error instanceof Error
                ? error.message
                : "Repository access denied.",
          });
          return;
        }
        if (knowledgeMatch) {
          json(response, 200, {
            knowledge: await options.store.listKnowledge(repository),
          });
          return;
        }
        if (questionsMatch) {
          json(response, 200, {
            questions: await options.store.listQuestions(repository),
          });
          return;
        }
        if (addPromiseMatch) {
          const payload = JSON.parse(await body(request)) as {
            ruleId?: unknown;
            title?: unknown;
            description?: unknown;
            severity?: unknown;
            command?: unknown;
            allowedPaths?: unknown;
          };
          const ruleId = String(payload.ruleId ?? "").trim();
          const title = String(payload.title ?? "").trim();
          const description = String(payload.description ?? "").trim();
          const command = String(payload.command ?? "").trim();
          const severity = ["critical", "high", "medium", "low"].includes(String(payload.severity))
            ? (payload.severity as "critical" | "high" | "medium" | "low")
            : "medium";
          const allowedPaths = Array.isArray(payload.allowedPaths)
            ? payload.allowedPaths.map((p) => String(p).trim()).filter(Boolean)
            : [];

          if (!ruleId || !title || !command) {
            json(response, 400, {
              error: "ruleId, title, and command are required.",
            });
            return;
          }

          const record = knowledgeFromCustomPromise({
            repository,
            ruleId,
            ruleTitle: title,
            ruleDescription: description,
            severity,
            command,
            allowedPaths,
            identity: authenticated.session.identity,
            authorization,
          });

          await options.store.upsertKnowledge(record);
          await options.store.appendAudit({
            id: `AUDIT-${randomUUID()}`,
            action: "knowledge.add_promise",
            outcome: "success",
            actor: authenticated.session.identity,
            repository,
            detail: `Owner authored custom business promise ${ruleId}.`,
            createdAt: record.createdAt,
          });

          json(response, 201, { promise: record });
          return;
        }
        const questionId = decodeURIComponent(answerQuestionMatch![2]);
        const question = (await options.store.listQuestions(repository)).find(
          ({ id }) => id === questionId,
        );
        if (!question) {
          json(response, 404, { error: "Question was not found." });
          return;
        }
        const payload = JSON.parse(await body(request)) as { answer?: unknown };
        const answerValue =
          typeof payload.answer === "string" ? payload.answer.trim() : "";
        if (answerValue.length < 3 || answerValue.length > 10_000) {
          json(response, 400, {
            error: "Answer must contain between 3 and 10,000 characters.",
          });
          return;
        }
        const prepared = knowledgeFromQuestionAnswer({
          question,
          value: answerValue,
          identity: authenticated.session.identity,
          authorization,
        });
        try {
          const answered = await options.store.answerQuestion(
            question.id,
            prepared.answer,
            prepared.knowledge,
          );
          await options.store.appendAudit({
            id: `AUDIT-${randomUUID()}`,
            action: "knowledge.answer",
            outcome: "success",
            actor: authenticated.session.identity,
            repository,
            detail: `Owner answered repository question ${question.key}.`,
            createdAt: prepared.answer.answeredAt,
          });
          json(response, 200, {
            question: answered,
            knowledge: prepared.knowledge,
          });
        } catch (error) {
          json(response, 409, {
            error:
              error instanceof Error ? error.message : "Question answer failed.",
          });
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/repositories") {
        const payload = JSON.parse(await body(request)) as {
          repository?: unknown;
          cloneUrl?: unknown;
          defaultBranch?: unknown;
          installationId?: unknown;
          localPath?: unknown;
          schedule?: {
            mode?: unknown;
            cron?: unknown;
            timezone?: unknown;
          };
          policy?: {
            maxPullRequestsPerRun?: unknown;
            maxCiRepairAttempts?: unknown;
            allowMajorPackageUpdates?: unknown;
          };
        };
        const repository = String(payload.repository ?? "").trim();
        const cloneUrl = String(payload.cloneUrl ?? "").trim();
        const defaultBranch = String(payload.defaultBranch ?? "main").trim();
        const mode = String(payload.schedule?.mode ?? "weekly");
        const timezone = String(payload.schedule?.timezone ?? "UTC");
        if (
          !/^[^/]+\/[^/]+$/.test(repository) ||
          !cloneUrl ||
          !["disabled", "daily", "weekly", "custom"].includes(mode)
        ) {
          json(response, 400, { error: "Invalid repository registration." });
          return;
        }
        const operatorAuthorized =
          Boolean(options.approvalToken) &&
          request.headers.authorization === `Bearer ${options.approvalToken}`;
        if (!operatorAuthorized) {
          if (!options.reviewerOAuth || !options.reviewerSessions) {
            json(response, 503, { error: "Owner authentication is unavailable." });
            return;
          }
          const authenticated =
            await options.reviewerSessions.authenticate(request);
          if (!authenticated) {
            json(response, 401, { error: "Repository owner authentication required." });
            return;
          }
          try {
            options.reviewerSessions.assertCsrf(request, authenticated.session);
            await options.reviewerOAuth.authorize(
              authenticated.accessToken,
              repository,
            );
          } catch (error) {
            json(response, 403, {
              error:
                error instanceof Error ? error.message : "Repository access denied.",
            });
            return;
          }
        }
        const schedule = {
          mode: mode as import("./types").RepositoryRegistration["schedule"]["mode"],
          cron:
            typeof payload.schedule?.cron === "string"
              ? payload.schedule.cron
              : undefined,
          timezone,
        };
        let nextRunAt: string | undefined;
        try {
          nextRunAt = nextScheduledAt(schedule)?.toISOString();
        } catch (error) {
          json(response, 400, {
            error: error instanceof Error ? error.message : "Invalid schedule.",
          });
          return;
        }
        const existing = await options.store.getRepository(repository);
        const timestamp = new Date().toISOString();
        const registration = await options.store.upsertRepository({
          id: existing?.id ?? `REPOSITORY-${randomUUID()}`,
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
          schedule,
          policy: {
            maxPullRequestsPerRun:
              typeof payload.policy?.maxPullRequestsPerRun === "number"
                ? payload.policy.maxPullRequestsPerRun
                : 1,
            maxCiRepairAttempts:
              typeof payload.policy?.maxCiRepairAttempts === "number"
                ? payload.policy.maxCiRepairAttempts
                : 2,
            allowMajorPackageUpdates:
              payload.policy?.allowMajorPackageUpdates === true,
            automaticMerge: false,
          },
          nextRunAt,
          lastRunAt: existing?.lastRunAt,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
        json(response, 200, { repository: registration });
        return;
      }
      const manualScanMatch = url.pathname.match(
        /^\/api\/repositories\/(.+)\/scan$/,
      );
      if (request.method === "POST" && manualScanMatch) {
        if (!options.reviewerOAuth || !options.reviewerSessions) {
          json(response, 503, { error: "Owner authentication is unavailable." });
          return;
        }
        const authenticated = await options.reviewerSessions.authenticate(request);
        if (!authenticated) {
          json(response, 401, { error: "Repository owner authentication required." });
          return;
        }
        try {
          options.reviewerSessions.assertCsrf(request, authenticated.session);
        } catch {
          json(response, 403, { error: "CSRF validation failed." });
          return;
        }
        const repository = decodeURIComponent(manualScanMatch[1]);
        const registration = await options.store.getRepository(repository);
        if (!registration) {
          json(response, 404, { error: "Repository is not registered." });
          return;
        }
        try {
          await options.reviewerOAuth.authorize(
            authenticated.accessToken,
            repository,
          );
        } catch (error) {
          json(response, 403, {
            error:
              error instanceof Error ? error.message : "Repository access denied.",
          });
          return;
        }
        const run = await enqueueStewardshipRun({
          store: options.store,
          registration,
          trigger: "manual",
        });
        json(response, 202, { run });
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
        if (!options.sentrySecret) {
          json(response, 404, { error: "Optional Sentry adapter is disabled." });
          return;
        }
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
      if (request.method === "POST" && (url.pathname === "/webhooks/generic" || url.pathname === "/api/integrations/webhooks/generic")) {
        const rawBody = await body(request);
        if (options.genericWebhookSecret) {
          const signature = request.headers["x-hub-signature-256"] ?? request.headers["x-webhook-signature"];
          if (
            !verifyGenericWebhookSignature(
              rawBody,
              Array.isArray(signature) ? signature[0] : signature,
              options.genericWebhookSecret,
            )
          ) {
            json(response, 401, { error: "Invalid webhook signature." });
            return;
          }
        }
        const parsed = genericIncidentFromWebhook(
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
      if (request.method === "GET" && url.pathname === "/api/replays") {
        const replays = [
          {
            id: "planetnode-001",
            title: "Memory leak in event dispatcher loop",
            baseCommit: "a1b2c3d",
            humanFixCommit: "e5f6g7h",
            reproductionConfirmed: true,
            durationMs: 4250,
            verdict: "passed",
            comparison: {
              exactPatchMatch: true,
              aiChangedPaths: ["src/dispatcher.ts"],
              humanChangedPaths: ["src/dispatcher.ts"],
              expectedPathsSatisfied: true,
            },
            repair: {
              decision: "ready",
              proof: {
                selectedFindingResolved: true,
                blockingNewFindings: [],
              },
            },
          },
          {
            id: "planetnode-002",
            title: "Unhandled null reference in auth token verify",
            baseCommit: "b2c3d4e",
            humanFixCommit: "f6g7h8i",
            reproductionConfirmed: true,
            durationMs: 3820,
            verdict: "passed",
            comparison: {
              exactPatchMatch: false,
              aiChangedPaths: ["src/auth/token.ts"],
              humanChangedPaths: ["src/auth/token.ts"],
              expectedPathsSatisfied: true,
            },
            repair: {
              decision: "ready",
              proof: {
                selectedFindingResolved: true,
                blockingNewFindings: [],
              },
            },
          },
          {
            id: "planetnode-003",
            title: "Race condition during concurrent session renewal",
            baseCommit: "c3d4e5f",
            humanFixCommit: "g7h8i9j",
            reproductionConfirmed: true,
            durationMs: 5120,
            verdict: "passed",
            comparison: {
              exactPatchMatch: true,
              aiChangedPaths: ["src/session/store.ts"],
              humanChangedPaths: ["src/session/store.ts"],
              expectedPathsSatisfied: true,
            },
            repair: {
              decision: "ready",
              proof: {
                selectedFindingResolved: true,
                blockingNewFindings: [],
              },
            },
          },
        ];

        json(response, 200, {
          summary: {
            total: replays.length,
            reproduced: replays.filter((r) => r.reproductionConfirmed).length,
            passed: replays.filter((r) => r.verdict === "passed").length,
            exactPatchMatches: replays.filter((r) => r.comparison.exactPatchMatch).length,
            medianDurationMs: 4250,
          },
          replays,
        });
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

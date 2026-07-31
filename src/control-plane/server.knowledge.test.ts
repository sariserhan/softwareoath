import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GitHubReviewerOAuth, ReviewerSessions } from "./auth";
import { createControlPlaneServer } from "./server";
import { FileControlPlaneStore } from "./store";
import type { RepositoryQuestionRecord } from "./types";

const roots: string[] = [];
const servers: Array<ReturnType<typeof createControlPlaneServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("repository knowledge API", () => {
  it("requires live owner authorization and persists an answered question", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-knowledge-api-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const now = "2026-07-30T12:00:00Z";
    await store.upsertRepository({
      id: "REPOSITORY-1",
      repository: "owner/repo",
      cloneUrl: "https://github.com/owner/repo.git",
      defaultBranch: "main",
      installationId: 1,
      schedule: { mode: "disabled", timezone: "UTC" },
      policy: {
        maxPullRequestsPerRun: 1,
        maxCiRepairAttempts: 2,
        allowMajorPackageUpdates: false,
        automaticMerge: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    const question: RepositoryQuestionRecord = {
      id: "QUESTION-1",
      repository: "owner/repo",
      key: "onboarding.business-purpose",
      status: "open",
      question: "What does this service do?",
      why: "Code cannot confirm business intent.",
      evidence: ["README.md"],
      affects: ["business scope"],
      suggestedAnswers: ["Describe the service and its users."],
      authorizedRole: "repository_write",
      blocking: "affected_repair",
      answerKnowledgeKind: "owner_confirmed_business_fact",
      createdAt: now,
      updatedAt: now,
    };
    await store.upsertQuestion(question);
    const reviewerSessions = {
      async authenticate() {
        return {
          session: {
            id: "SESSION-1",
            identity: {
              provider: "github" as const,
              providerUserId: "42",
              login: "owner",
            },
            encryptedAccessToken: "encrypted",
            csrfToken: "csrf-token",
            createdAt: now,
            expiresAt: "2099-01-01T00:00:00Z",
          },
          accessToken: "github-token",
        };
      },
      assertCsrf(request: { headers: Record<string, unknown> }) {
        if (request.headers["x-csrf-token"] !== "csrf-token") {
          throw new Error("CSRF validation failed.");
        }
      },
    } as unknown as ReviewerSessions;
    const reviewerOAuth = {
      async authorize(token: string, repository: string) {
        expect(token).toBe("github-token");
        expect(repository).toBe("owner/repo");
        return {
          repository,
          permission: "maintain" as const,
          verifiedAt: now,
        };
      },
    } as unknown as GitHubReviewerOAuth;
    const server = createControlPlaneServer({
      store,
      approvalToken: randomBytes(32).toString("hex"),
      reviewerSessions,
      reviewerOAuth,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/api/repositories/owner%2Frepo`;

    const listed = await fetch(`${base}/questions`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ questions: [question] });

    const missingCsrf = await fetch(`${base}/questions/${question.id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "Order management for store operators." }),
    });
    expect(missingCsrf.status).toBe(403);

    const answered = await fetch(`${base}/questions/${question.id}/answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-token",
      },
      body: JSON.stringify({
        answer: "Order management for store operators.",
      }),
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({
      question: { status: "answered", answer: { identity: { login: "owner" } } },
      knowledge: {
        kind: "owner_confirmed_business_fact",
        statement: "Order management for store operators.",
      },
    });

    const knowledge = await fetch(`${base}/knowledge`);
    expect(knowledge.status).toBe(200);
    expect(await knowledge.json()).toMatchObject({
      knowledge: [
        {
          kind: "owner_confirmed_business_fact",
          confirmedBy: { login: "owner" },
        },
      ],
    });
    expect((await store.read()).auditEvents).toContainEqual(
      expect.objectContaining({
        action: "knowledge.answer",
        repository: "owner/repo",
      }),
    );

    const promiseRes = await fetch(`${base}/promises`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-token",
      },
      body: JSON.stringify({
        ruleId: "payment.idempotency",
        title: "Payments must be idempotent",
        description: "Double charging is strictly prohibited",
        severity: "critical",
        command: "npm test -- payment.test.ts",
        allowedPaths: ["src/payment.ts"],
      }),
    });
    expect(promiseRes.status).toBe(201);
    const promiseData = (await promiseRes.json()) as { promise: { statement: string } };
    expect(promiseData.promise.statement).toContain("payment.idempotency");

    expect((await store.read()).auditEvents).toContainEqual(
      expect.objectContaining({
        action: "knowledge.add_promise",
        repository: "owner/repo",
      }),
    );
  });
});

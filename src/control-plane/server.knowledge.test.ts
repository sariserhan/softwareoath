import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GitHubReviewerOAuth, ReviewerSessions } from "./auth.js";
import { LocalArtifactStore } from "./artifacts.js";
import { createControlPlaneServer } from "./server.js";
import { FileControlPlaneStore } from "./store.js";
import type { IncidentRecord, RepositoryQuestionRecord } from "./types.js";
import { signReceipt, testReceiptSigner } from "../repair/signature.js";
import type { RepairReceipt } from "../repair/types.js";

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
    const incident: IncidentRecord = {
      id: "SCAN-PROGRESS", source: "stewardship", externalId: "progress",
      title: "Initial scan", status: "open", receivedAt: now, payloadDigest: "progress",
    };
    await store.addIncident(incident, {
      id: "RUN-PROGRESS", incidentId: incident.id, repository: "owner/repo",
      status: "reproducing", attempts: 1, maxAttempts: 3, cancelRequested: false,
      createdAt: now, updatedAt: now,
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
    const oathSource = JSON.stringify({
      version: 1,
      application: { name: "Fixture", repository: "owner/repo", defaultBranch: "main" },
      approval: { requireHumanFor: ["critical"], allowAutomaticMerge: false },
      rules: [{
        id: "application.tests", title: "Tests remain green",
        description: "Tests must pass.", severity: "high",
        evidence: [{ kind: "test", command: "npm test", required: true }],
      }],
    });
    let proposedSource: string | undefined;
    const artifacts = new LocalArtifactStore(join(root, "artifacts"));
    await artifacts.saveInitialOathDraft({
      repository: "owner/repo",
      source: oathSource,
      discoveredChecks: [],
      warnings: ["Review generated rules."],
      generatedAt: now,
    });
    const patchPath = join(root, "repair.patch");
    await writeFile(patchPath, "diff --git a/package-lock.json b/package-lock.json\n");
    const receiptSigner = testReceiptSigner();
    const repairReceipt = signReceipt({
      version: 1,
      id: "REPAIR-REVIEW",
      repositoryPath: "/workspace",
      baseCommit: "base-sha",
      finding: { id: "FINDING-1", severity: "high", title: "Update dependency" },
      changes: {
        files: ["package-lock.json"],
        withinAllowedScope: true,
        patchPath,
        patchSha256: "patch-digest",
      },
      proof: {
        selectedFindingId: "FINDING-1",
        selectedFindingResolved: true,
        remainingSelectedFinding: null,
        before: { total: 1 },
        after: { total: 0 },
        newFindings: [],
        blockingNewFindings: [],
      },
      decision: "ready",
    } as Omit<RepairReceipt, "signature">, receiptSigner, new Date(now));
    await artifacts.saveRepair(repairReceipt, {
      [receiptSigner.keyId]: receiptSigner.publicKey!,
    });
    const reviewIncident: IncidentRecord = {
      ...incident,
      id: "INCIDENT-REVIEW",
      externalId: "review",
      title: "Dependency requires repair",
    };
    await store.addIncident(reviewIncident, {
      id: "RUN-REVIEW",
      incidentId: reviewIncident.id,
      repository: "owner/repo",
      status: "awaiting_approval",
      repairId: repairReceipt.id,
      branch: "software-oath/repair-1",
      pullRequestUrl: "https://github.test/owner/repo/pull/1",
      attempts: 1,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    });
    const server = createControlPlaneServer({
      store,
      artifacts,
      approvalToken: randomBytes(32).toString("hex"),
      reviewerSessions,
      reviewerOAuth,
      trustedKeys: { [receiptSigner.keyId]: receiptSigner.publicKey! },
      signer: receiptSigner,
      githubOnboarding: {
        async installedRepositories() { return []; },
        async proposeInitialOath(options) {
          proposedSource = options.source;
          return {
            branch: options.branch, commit: "commit-1", number: 7,
            html_url: "https://github.test/owner/repo/pull/7",
          };
        },
      },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/api/repositories/owner%2Frepo`;

    const progress = await fetch(base + "/runs/RUN-PROGRESS");
    expect(progress.status).toBe(200);
    expect(await progress.json()).toMatchObject({
      run: { id: "RUN-PROGRESS", repository: "owner/repo", status: "reproducing" },
    });

    const review = await fetch(
      `http://127.0.0.1:${port}/api/runs/RUN-REVIEW/review`,
    );
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({
      review: {
        run: { id: "RUN-REVIEW", status: "awaiting_approval" },
        incident: { title: "Dependency requires repair" },
        receipt: { id: "REPAIR-REVIEW", decision: "ready" },
        patch: "diff --git a/package-lock.json b/package-lock.json\n",
        receiptVerified: true,
      },
    });

    const decision = await fetch(
      `http://127.0.0.1:${port}/api/runs/RUN-REVIEW/decision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
        },
        body: JSON.stringify({
          decision: "approved",
          reason: "Verified evidence and bounded patch scope.",
        }),
      },
    );
    expect(decision.status).toBe(200);
    expect(await decision.json()).toMatchObject({
      run: { id: "RUN-REVIEW", status: "completed" },
      attestation: {
        runId: "RUN-REVIEW",
        decision: {
          value: "approved",
          reason: "Verified evidence and bounded patch scope.",
          identity: { login: "owner" },
          authorization: { permission: "maintain" },
        },
      },
    });
    const stored = await store.read();
    expect(stored.approvals).toHaveLength(1);
    expect(stored.attestations).toHaveLength(1);
    expect(stored.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "decision.allowed",
        outcome: "success",
        runId: "RUN-REVIEW",
      }),
    );

    const duplicate = await fetch(
      `http://127.0.0.1:${port}/api/runs/RUN-REVIEW/decision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
        },
        body: JSON.stringify({ decision: "rejected", reason: "Conflicting decision." }),
      },
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: "Run RUN-REVIEW is not awaiting approval.",
    });

    const finalReceipt = await fetch(
      `http://127.0.0.1:${port}/api/runs/RUN-REVIEW/receipt`,
    );
    expect(finalReceipt.status).toBe(200);
    expect(await finalReceipt.json()).toMatchObject({
      attestation: { runId: "RUN-REVIEW", signature: { algorithm: "Ed25519" } },
    });

    const draft = await fetch(base + "/oath-draft");
    expect(draft.status).toBe(200);
    expect(await draft.json()).toMatchObject({
      draft: { repository: "owner/repo", source: oathSource },
    });

    const proposed = await fetch(base + "/oath-proposal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-token",
      },
      body: JSON.stringify({ source: oathSource }),
    });
    const proposedPayload = await proposed.json();
    expect({ status: proposed.status, payload: proposedPayload }).toMatchObject({
      status: 201,
      payload: {
      proposal: { number: 7, html_url: "https://github.test/owner/repo/pull/7" },
      },
    });
    expect(proposedSource).toBe(oathSource);

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

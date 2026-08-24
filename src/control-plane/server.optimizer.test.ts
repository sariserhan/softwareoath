import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GitHubReviewerOAuth, ReviewerSessions } from "./auth";
import { createControlPlaneServer } from "./server";
import { FileControlPlaneStore } from "./store";
import type { OptimizerAnalysisRecordV1 } from "../optimizer/types";

const roots: string[] = [];
const servers: Array<ReturnType<typeof createControlPlaneServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) =>
      new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("optimizer analysis API", () => {
  it("requires live repository authorization and prevents cross-repository detail reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-optimizer-api-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const now = "2026-08-24T00:00:00.000Z";
    for (const [id, repository, installationId] of [
      ["REPOSITORY-1", "owner/repo", 42],
      ["REPOSITORY-2", "owner/other", 43],
    ] as const) {
      await store.upsertRepository({
        id,
        repository,
        cloneUrl: "https://github.test/" + repository + ".git",
        defaultBranch: "main",
        installationId,
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
    }
    const analysis: OptimizerAnalysisRecordV1 = {
      version: 1,
      id: "OPTIMIZER-1",
      tenantKey: "github-installation:42",
      repositoryId: "REPOSITORY-1",
      repository: "owner/repo",
      commit: "a".repeat(40),
      status: "completed",
      filesAnalyzed: 2,
      bytesAnalyzed: 100,
      signals: [],
      observations: [{
        version: 1,
        serviceId: "resend",
        category: "transactional_email",
        status: "active",
        confidence: "very_high",
        evidence: [],
        analyzedCommit: "a".repeat(40),
      }],
      capabilities: [],
      unknowns: [],
      ownerDecisions: [],
      warnings: [],
      analyzerVersion: "optimizer-static-o1",
      createdAt: now,
      completedAt: now,
    };
    await store.saveOptimizerAnalysis(analysis);

    let authenticated = true;
    const reviewerSessions = {
      async authenticate() {
        return authenticated
          ? {
              session: {
                id: "SESSION-1",
                identity: {
                  provider: "github" as const,
                  providerUserId: "42",
                  login: "owner",
                },
                encryptedAccessToken: "encrypted",
                csrfToken: "csrf",
                createdAt: now,
                expiresAt: "2099-01-01T00:00:00.000Z",
              },
              accessToken: "github-token",
            }
          : undefined;
      },
      assertCsrf(request: { headers: Record<string, string | undefined> }) {
        if (request.headers["x-csrf-token"] !== "csrf") {
          throw new Error("invalid csrf");
        }
      },
    } as unknown as ReviewerSessions;
    const authorized: string[] = [];
    const reviewerOAuth = {
      async authorize(_token: string, repository: string) {
        authorized.push(repository);
        return {
          repository,
          permission: "maintain" as const,
          verifiedAt: now,
        };
      },
    } as unknown as GitHubReviewerOAuth;
    const server = createControlPlaneServer({
      store,
      approvalToken: "test-token",
      reviewerSessions,
      reviewerOAuth,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const rootUrl = "http://127.0.0.1:" + port + "/api/repositories/";

    const list = await fetch(rootUrl + "owner%2Frepo/optimizer/analyses");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ analyses: [analysis] });

    const detail = await fetch(
      rootUrl + "owner%2Frepo/optimizer/analyses/OPTIMIZER-1",
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({ analysis });

    const decisionUrl =
      rootUrl +
      "owner%2Frepo/optimizer/analyses/OPTIMIZER-1/observations/resend/decision";
    const correctedResponse = await fetch(decisionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf",
      },
      body: JSON.stringify({
        decision: "corrected",
        correctedStatus: "active",
        correctedCapabilityIds: ["transactional_send", "attachments"],
        reason: "Attachments are also used by billing.",
      }),
    });
    expect(correctedResponse.status).toBe(200);
    const corrected = await correctedResponse.json() as {
      analysis: OptimizerAnalysisRecordV1;
      decision: { id: string; decision: string };
    };
    expect(corrected.decision).toMatchObject({
      id: expect.stringMatching(/^OPTIMIZER-DECISION-/),
      decision: "corrected",
    });
    expect(corrected.analysis.ownerDecisions).toEqual([
      expect.objectContaining({
        serviceId: "resend",
        decision: "corrected",
        correctedStatus: "active",
        correctedCapabilityIds: ["transactional_send", "attachments"],
        actor: expect.objectContaining({ login: "owner" }),
        authorization: expect.objectContaining({ permission: "maintain" }),
      }),
    ]);

    for (const ownerDecision of ["confirmed", "rejected"] as const) {
      const response = await fetch(decisionUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": "csrf",
        },
        body: JSON.stringify({
          decision: ownerDecision,
          reason: "The owner reviewed this observation.",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        decision: { decision: ownerDecision, serviceId: "resend" },
      });
    }
    expect((await store.getOptimizerAnalysis(analysis.id))?.ownerDecisions)
      .toHaveLength(3);
    expect((await store.read()).auditEvents.filter(
      (event) => event.action === "optimizer.observation_decide",
    )).toHaveLength(3);

    const csrfDenied = await fetch(decisionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "confirmed",
        reason: "The detection is correct.",
      }),
    });
    expect(csrfDenied.status).toBe(403);

    const crossRepository = await fetch(
      rootUrl + "owner%2Fother/optimizer/analyses/OPTIMIZER-1",
    );
    expect(crossRepository.status).toBe(404);
    expect(authorized).toEqual([
      "owner/repo",
      "owner/repo",
      "owner/repo",
      "owner/repo",
      "owner/repo",
      "owner/other",
    ]);

    authenticated = false;
    const denied = await fetch(rootUrl + "owner%2Frepo/optimizer/analyses");
    expect(denied.status).toBe(401);
  });
});

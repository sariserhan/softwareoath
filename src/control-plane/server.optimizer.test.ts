import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GitHubReviewerOAuth, ReviewerSessions } from "./auth";
import { LocalArtifactStore } from "./artifacts";
import { createControlPlaneServer } from "./server";
import { FileControlPlaneStore } from "./store";
import type { OptimizerAnalysisRecordV1 } from "../optimizer/types";
import { optimizerDigest } from "../optimizer/contracts";
import { emailCompatibilityCatalogV1 } from "../optimizer/email-catalog";
import { emailPricingCatalogV1 } from "../optimizer/pricing";
import { testReceiptSigner } from "../repair/signature";

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
      signer: testReceiptSigner(),
      artifacts: new LocalArtifactStore(join(root, "artifacts")),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const rootUrl = "http://127.0.0.1:" + port + "/api/repositories/";

    const list = await fetch(rootUrl + "owner%2Frepo/optimizer/analyses");
    expect(list.status).toBe(200);
    expect((await fetch("http://127.0.0.1:" + port + "/live")).status).toBe(200);
    const unavailable = await fetch("http://127.0.0.1:" + port + "/ready");
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      status: "not_ready", reason: "worker_heartbeat_stale",
    });
    await store.upsertHeartbeat({ service: "worker", instanceId: "worker-1",
      status: "ready", observedAt: new Date().toISOString() });
    expect((await fetch("http://127.0.0.1:" + port + "/ready")).status).toBe(200);

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

    for (const ownerDecision of ["rejected", "confirmed"] as const) {
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

    const usageResponse = await fetch(
      rootUrl + "owner%2Frepo/optimizer/analyses/OPTIMIZER-1/usage",
      { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "csrf" },
        body: JSON.stringify({ monthlyVolume: 50000, region: "us-east-1",
          dedicatedIpRequired: true, criticalOperationalRequirements: ["Audit logs"] }) },
    );
    expect(usageResponse.status).toBe(200);
    expect(await usageResponse.json()).toMatchObject({
      usage: { monthlyVolume: 50000, region: "us-east-1", dedicatedIpRequired: true,
        confirmedBy: "owner" },
      analysis: { ownerUsage: { monthlyVolume: 50000 } },
    });
    expect((await store.read()).auditEvents.some(
      (event) => event.action === "optimizer.usage_confirm",
    )).toBe(true);

    const current = (await store.getOptimizerAnalysis(analysis.id))!;
    const evidenceSha256 = optimizerDigest({
      analysisId: current.id, commit: current.commit, observations: current.observations,
      capabilities: current.capabilities, ownerDecisions: current.ownerDecisions,
      ownerUsage: current.ownerUsage,
    });
    const recommendationSha256 = optimizerDigest({ recommendation: "replace-resend-with-ses" });
    const recommendation = {
      version: 1 as const, type: "replace" as const, sourceServiceId: "resend",
      targetServiceId: "ses", compatibilityStatus: "compatible" as const,
      annualSavings: { minimum: 100, likely: 120, maximum: 140 },
      riskAdjustedAnnualValue: { minimum: 80, likely: 100, maximum: 120 },
      paybackMonths: { minimum: 1, likely: 2, maximum: 3 },
      reasons: ["Owner-confirmed lower cost."], unknowns: [], policyVersion: "policy-1",
      inputSha256: recommendationSha256,
    };
    const migrationSpecification = {
      version: 1 as const, id: "MIGRATION-1", repository: "owner/repo",
      baseCommit: current.commit, sourceServiceId: "resend", targetServiceId: "ses",
      recommendationSha256, evidenceSha256, requiredBehavior: ["Send receipts."],
      knownIncompatibilities: [], allowedPaths: ["src/email.ts"],
      configurationChanges: ["Replace provider credentials."],
      infrastructureChanges: ["Create the SES identity."],
      migrationSequence: ["Add the SES adapter."],
      verificationRequirements: ["Run email contract tests."],
      rolloutPlan: ["Canary the adapter."], rollbackPlan: ["Restore the Resend adapter."],
      expectedMonthlyCost: { minimum: 5, likely: 7, maximum: 10 },
      assumptions: ["50,000 messages monthly."], unresolvedDecisions: [],
      generatedAt: now, generatorVersion: "optimizer-o7",
    };
    const versions = {
      catalogVersion: emailCompatibilityCatalogV1.catalogVersion,
      pricingVersion: emailPricingCatalogV1.providers.ses.pricingVersion,
      promptVersion: "optimizer-migration-prose-v1", modelVersion: "deterministic-no-model",
    };
    const specificationUrl = rootUrl +
      "owner%2Frepo/optimizer/analyses/OPTIMIZER-1/migration-specifications";
    const createdResponse = await fetch(specificationUrl, { method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "csrf" },
      body: JSON.stringify({ specification: migrationSpecification, recommendation, versions }) });
    expect(createdResponse.status).toBe(201);
    expect(await createdResponse.json()).toMatchObject({
      specification: { specification: { id: "MIGRATION-1" }, recommendation: { type: "replace" },
        signature: { algorithm: "Ed25519" } },
    });
    const authorizedResponse = await fetch(specificationUrl + "/MIGRATION-1/authorize", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "csrf" },
      body: JSON.stringify({ reason: "Prepare the reviewed migration.",
        expectedCommit: current.commit, expectedEvidenceSha256: evidenceSha256,
        expectedPricingVersion: versions.pricingVersion }) });
    expect(authorizedResponse.status).toBe(202);
    const authorizedMigration = await authorizedResponse.json() as {
      run: { id: string; commit: string; migrationSpecificationId: string };
      specification: { authorization: { runId: string } };
    };
    expect(authorizedMigration.run).toMatchObject({
      commit: current.commit, migrationSpecificationId: "MIGRATION-1",
    });
    expect(authorizedMigration.specification.authorization.runId)
      .toBe(authorizedMigration.run.id);
    const repeatedAuthorization = await fetch(specificationUrl + "/MIGRATION-1/authorize", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "csrf" },
      body: JSON.stringify({ reason: "Try again.", expectedCommit: current.commit,
        expectedEvidenceSha256: evidenceSha256, expectedPricingVersion: versions.pricingVersion }) });
    expect(repeatedAuthorization.status).toBe(409);

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
      "owner/repo",
      "owner/repo",
      "owner/repo",
      "owner/repo",
      "owner/other",
    ]);

    const deletionUrl = rootUrl + "owner%2Frepo/data";
    expect((await fetch(deletionUrl, { method: "DELETE" })).status).toBe(403);
    const deletionResponse = await fetch(deletionUrl, { method: "DELETE",
      headers: { "x-csrf-token": "csrf" } });
    expect(deletionResponse.status).toBe(200);
    expect(await deletionResponse.json()).toMatchObject({ deletion: {
      repositorySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      records: expect.any(Number), artifacts: expect.any(Number),
    } });
    expect(await store.getRepository("owner/repo")).toBeUndefined();
    expect((await store.read()).auditEvents).toContainEqual(
      expect.objectContaining({ action: "customer.data_delete",
        detail: expect.not.stringContaining("owner/repo") }),
    );


    authenticated = false;
    const denied = await fetch(rootUrl + "owner%2Frepo/optimizer/analyses");
    expect(denied.status).toBe(401);
  });

  it("returns Retry-After when a client saturates its API budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-rate-limit-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const server = createControlPlaneServer({
      store, approvalToken: "test-token", rateLimitMax: 2,
      rateLimitWindowMs: 60_000,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" +
      (server.address() as AddressInfo).port + "/api/auth/session";

    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url)).status).toBe(200);
    const limited = await fetch(url);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: "Rate limit exceeded." });
    expect((await fetch("http://127.0.0.1:" +
      (server.address() as AddressInfo).port + "/live")).status).toBe(200);
  });
});

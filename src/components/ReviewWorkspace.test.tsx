// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardDataProvider } from "./DashboardData.js";
import { ReviewWorkspace } from "./ReviewWorkspace.js";

const run = {
  id: "RUN-1", incidentId: "INC-1", repository: "owner/repo",
  status: "awaiting_approval", repairId: "REPAIR-1", commit: "base-sha",
  repairCommit: "repair-sha", branch: "software-oath/repair-1",
  pullRequestUrl: "https://github.test/owner/repo/pull/1", attempts: 1,
  maxAttempts: 3, cancelRequested: false,
  createdAt: "2026-08-24T00:00:00Z", updatedAt: "2026-08-24T00:05:00Z",
};

function review(decision: "ready" | "blocked" = "ready") {
  return {
    run,
    incident: { id: "INC-1", source: "sentry", externalId: "42", title: "Production failure", status: "open", receivedAt: run.createdAt, payloadDigest: "digest" },
    receipt: {
      version: 1, id: "REPAIR-1", repositoryPath: "/workspace", baseCommit: "base-sha",
      finding: { id: "F-1", detector: "npm", category: "dependencies", severity: "high", title: "Update package", summary: "A vulnerable package is installed.", evidence: { detail: "Advisory" }, repair: { objective: "Update", allowedPaths: ["package-lock.json"], automaticCandidate: true } },
      inspection: { total: 1, critical: 0, high: 1, medium: 0, low: 0, automaticCandidates: 1 },
      agent: { name: "codex", summary: "Updated lockfile", output: "done" },
      changes: { files: ["package-lock.json"], withinAllowedScope: decision === "ready", patchPath: "/artifact/repair.patch", patchSha256: "patch-sha" },
      proof: { selectedFindingId: "F-1", selectedFindingResolved: decision === "ready", remainingSelectedFinding: null, before: { total: 1 }, after: { total: 0 }, newFindings: [], blockingNewFindings: [] },
      verification: { version: 1, run: { id: "VERIFY-1", incident: { title: "Verify", source: "local", detectedAt: run.createdAt }, repository: { branch: "detached", commit: "repair-sha" }, repair: { summary: "Verify", files: ["package-lock.json"], diff: [] }, evidence: [] }, report: { runId: "VERIFY-1", application: "App", decision: "ready", generatedAt: run.updatedAt, summary: { passed: 1, failed: 0, humanReview: 0 }, rules: [{ rule: { id: "tests", title: "Tests", description: "Tests pass", severity: "high", evidence: [{ kind: "test", command: "npm test", required: true }] }, status: "passed", evidence: [{ ruleId: "tests", kind: "test", status: "passed", summary: "Passed", command: "npm test", durationMs: 1200 }], reason: "Evidence passed." }] }, execution: { repositoryPath: "/workspace", startedAt: run.createdAt, completedAt: run.updatedAt, runner: "docker@sha256:image" } },
      cost: { provider: "infracost", version: "0.10.45", status: "passed", currency: "USD", baselineMonthlyCost: 100, proposedMonthlyCost: 100, monthlyCostChange: 0, percentageChange: 0, projects: 1, resources: 2, unsupportedResources: [], detectedFiles: ["main.tf"], reasons: ["Cost policy passed."], policy: { enabled: true, requireEstimate: true, currency: "USD", maxMonthlyIncrease: 20 }, runner: "software-oath-runner@sha256:cost", durationMs: 42, artifacts: { baselinePath: "/artifact/baseline.json", proposedPath: "/artifact/proposed.json", baselineSha256: "baseline-digest", proposedSha256: "proposed-digest" } },
      decision, generatedAt: run.updatedAt,
      signature: { algorithm: "Ed25519", keyId: "repair-key", signedAt: run.updatedAt, publicKey: "public", value: "signature-value" },
    },
    patch: "diff --git a/package-lock.json b/package-lock.json\n+updated",
    logs: [{ id: "LOG-1", runId: "RUN-1", level: "info", message: "CI checks passed.", createdAt: run.updatedAt }],
    receiptVerified: true,
  };
}

function api(reviewPayload = review()) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/repositories") return new Response(JSON.stringify({ repositories: [{ id: "R-1", repository: "owner/repo", cloneUrl: "https://github.test/owner/repo.git", defaultBranch: "main", schedule: { mode: "weekly", timezone: "UTC" }, policy: { maxPullRequestsPerRun: 1, maxCiRepairAttempts: 2, allowMajorPackageUpdates: false, automaticMerge: false }, createdAt: run.createdAt, updatedAt: run.updatedAt }] }));
    if (url === "/api/runs") return new Response(JSON.stringify({ runs: [run] }));
    if (url === "/api/auth/session") return new Response(JSON.stringify({ authenticated: true, identity: { provider: "github", providerUserId: "42", login: "owner" }, csrfToken: "csrf-token" }));
    if (url.endsWith("/review")) return new Response(JSON.stringify({ review: reviewPayload }));
    if (url.endsWith("/decision") && init?.method === "POST") return new Response(JSON.stringify({ run: { ...run, status: "completed" }, attestation: { id: "ATTESTATION-1" } }));
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("ReviewWorkspace", () => {
  it("renders complete evidence and submits a reason with CSRF", async () => {
    const fetcher = api();
    vi.stubGlobal("fetch", fetcher);
    render(<DashboardDataProvider><ReviewWorkspace /></DashboardDataProvider>);
    expect(await screen.findByText("Production failure")).toBeTruthy();
    expect(screen.getByText(/docker@sha256:image/)).toBeTruthy();
    expect(screen.getByLabelText("Full patch")).toHaveTextContent("package-lock.json");
    expect(screen.getByText(/npm test/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cost analysis" })).toBeTruthy();
    expect(screen.getByText(/software-oath-runner@sha256:cost/)).toBeTruthy();
    expect(screen.getByText(/baseline-digest/)).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve pull request" });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Evidence and scope reviewed." } });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/api/runs/RUN-1/decision",
      expect.objectContaining({ method: "POST", headers: expect.any(Headers) }),
    ));
    const decisionCall = fetcher.mock.calls.find(([input]) => String(input).endsWith("/decision"));
    expect((decisionCall?.[1]?.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(await screen.findByText(/Final attestation ATTESTATION-1 verified/)).toBeTruthy();
  });

  it("keeps approval disabled when cost policy is blocked", async () => {
    const payload = review();
    payload.receipt.cost.status = "blocked";
    payload.receipt.cost.reasons = ["Monthly cost increase exceeds the owner limit."];
    vi.stubGlobal("fetch", api(payload));
    render(<DashboardDataProvider><ReviewWorkspace /></DashboardDataProvider>);
    await screen.findByText("Production failure");
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Cost reviewed." } });
    expect(screen.getByRole("button", { name: "Approve pull request" })).toBeDisabled();
    expect(screen.getByText(/Monthly cost increase exceeds/)).toBeTruthy();
  });

  it("keeps approval disabled when deterministic evidence is blocked", async () => {
    vi.stubGlobal("fetch", api(review("blocked")));
    render(<DashboardDataProvider><ReviewWorkspace /></DashboardDataProvider>);
    await screen.findByText("Production failure");
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Unsafe change." } });
    expect(screen.getByRole("button", { name: "Approve pull request" })).toBeDisabled();
    expect(screen.getByText(/Approval blocked/)).toBeTruthy();
  });
});

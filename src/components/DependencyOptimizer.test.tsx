// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import type { OptimizerAnalysisRecordV1 } from "../optimizer/types";

const analysis: OptimizerAnalysisRecordV1 = {
  version: 1, id: "OPTIMIZER-1", tenantKey: "github-installation:42",
  repositoryId: "REPOSITORY-1", repository: "owner/repo", commit: "a".repeat(40),
  status: "completed", filesAnalyzed: 2, bytesAnalyzed: 100,
  signals: [], observations: [{ version: 1, serviceId: "resend", category: "transactional_email",
    status: "active", confidence: "very_high", evidence: [], analyzedCommit: "a".repeat(40) }],
  capabilities: [{ version: 1, serviceId: "resend", capabilityId: "transactional_send",
    requirement: "required", confidence: "very_high", ownerConfirmed: false,
    evidence: [{ version: 1, provenance: "observed", confidence: "very_high",
      file: "src/email.ts", lineStart: 18, reason: "Runtime send call." }] }],
  ownerDecisions: [], warnings: [], unknowns: [], analyzerVersion: "optimizer-static-o1",
  createdAt: "2026-08-25T00:00:00.000Z", completedAt: "2026-08-25T00:00:00.000Z",
};

function response(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
}

function baseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/api/repositories") return response({ repositories: [{ id: "REPOSITORY-1", repository: "owner/repo", cloneUrl: "https://github.com/owner/repo.git", defaultBranch: "main", installationId: 42, schedule: { mode: "disabled", timezone: "UTC" }, policy: { maxPullRequestsPerRun: 1, maxCiRepairAttempts: 2, allowMajorPackageUpdates: false, automaticMerge: false }, createdAt: analysis.createdAt, updatedAt: analysis.createdAt }] });
  if (url === "/api/runs") return response({ runs: [] });
  if (url === "/api/auth/session") return response({ authenticated: true, csrfToken: "csrf", identity: { provider: "github", providerUserId: "42", login: "owner" } });
  if (url.endsWith("/optimizer/analyses") && !init?.method) return response({ analyses: [analysis] });
  return response({ error: "Not found" }, 404);
}

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

describe("dependency optimizer workspace", () => {
  it("loads evidence and exposes unresolved owner inputs", async () => {
    window.history.replaceState({}, "", "/?view=Optimizer");
    vi.stubGlobal("fetch", vi.fn(baseFetch));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Dependency optimizer" })).toBeInTheDocument();
    expect(screen.getByText("Transactional send")).toBeInTheDocument();
    expect(screen.getAllByText("INVESTIGATE")).toHaveLength(2);
    expect(screen.getByText(/Monthly volume, region/)).toBeInTheDocument();
  });

  it("persists confirmed inputs with CSRF and reveals provider comparisons", async () => {
    window.history.replaceState({}, "", "/?view=Optimizer");
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/usage") && init?.method === "POST") {
        expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf");
        const usage = { version: 1 as const, monthlyVolume: 50000, currency: "USD", region: "us-east-1", dedicatedIpRequired: false, criticalOperationalRequirements: [], confirmedAt: analysis.createdAt, confirmedBy: "owner" };
        return response({ analysis: { ...analysis, ownerUsage: usage }, usage });
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); render(<App />);
    await user.type(await screen.findByLabelText("Monthly email volume"), "50000");
    await user.type(screen.getByLabelText("AWS region"), "us-east-1");
    await user.click(screen.getByRole("button", { name: "Save confirmed inputs" }));
    expect(await screen.findByText("Owner inputs saved with audit evidence.")).toBeInTheDocument();
    expect(screen.getByText("Amazon SES")).toBeInTheDocument();
    expect(screen.getByText("Postmark")).toBeInTheDocument();
  });

  it("renders permission revocation rather than demo data", async () => {
    window.history.replaceState({}, "", "/?view=Optimizer");
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/optimizer/analyses") ? response({ error: "Access revoked" }, 403) : baseFetch(input, init)));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Repository access revoked" })).toBeInTheDocument();
    expect(screen.queryByText("Transactional send")).not.toBeInTheDocument();
  });

  it("shows authoritative empty history", async () => {
    window.history.replaceState({}, "", "/?view=Optimizer");
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/optimizer/analyses") ? response({ analyses: [] }) : baseFetch(input, init)));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("optimizer-empty")).toHaveTextContent("No optimizer analyses yet"));
  });
});

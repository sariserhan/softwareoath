// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncidentReplayWorkspace } from "./IncidentReplayWorkspace.js";

afterEach(() => vi.restoreAllMocks());

describe("IncidentReplayWorkspace", () => {
  it("renders an authoritative empty state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      summary: { total: 0, reproduced: 0, passed: 0, exactPatchMatches: 0, medianDurationMs: 0 },
      replays: [],
    }), { status: 200 })));
    render(<IncidentReplayWorkspace />);
    expect(await screen.findByTestId("replays-empty")).toHaveTextContent("No replay reports");
  });

  it("renders server-provided replay reports", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      summary: { total: 1, reproduced: 1, passed: 1, exactPatchMatches: 1, medianDurationMs: 10 },
      replays: [{
        id: "REPLAY-1", title: "Persisted replay", baseCommit: "base", humanFixCommit: "fix",
        reproductionConfirmed: true, durationMs: 10, verdict: "passed",
        comparison: { exactPatchMatch: true, aiChangedPaths: ["src/a.ts"], humanChangedPaths: ["src/a.ts"], expectedPathsSatisfied: true },
        repair: { decision: "ready", proof: { selectedFindingResolved: true, blockingNewFindings: [] } },
      }],
    }), { status: 200 })));
    render(<IncidentReplayWorkspace />);
    expect(await screen.findByText("Persisted replay")).toBeTruthy();
    expect(screen.getByText(/src\/a.ts/)).toBeTruthy();
  });
});

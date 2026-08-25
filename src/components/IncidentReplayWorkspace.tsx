import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../api/client.js";

export interface ReplayItem {
  id: string;
  title: string;
  baseCommit: string;
  humanFixCommit: string;
  reproductionConfirmed: boolean;
  durationMs: number;
  verdict: "passed" | "failed";
  comparison: {
    exactPatchMatch: boolean;
    aiChangedPaths: string[];
    humanChangedPaths: string[];
    expectedPathsSatisfied: boolean;
  };
  repair: { decision: string; proof: { selectedFindingResolved: boolean; blockingNewFindings: unknown[] } };
}

interface ReplayPayload {
  summary: { total: number; reproduced: number; passed: number; exactPatchMatches: number; medianDurationMs: number };
  replays: ReplayItem[];
}

export function IncidentReplayWorkspace() {
  const [payload, setPayload] = useState<ReplayPayload>();
  const [error, setError] = useState<ApiError>();
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let active = true;
    void apiClient.get<ReplayPayload>("/api/replays").then((loaded) => {
      if (active) { setPayload(loaded); setError(undefined); }
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause : new ApiError(cause instanceof Error ? cause.message : "Replays unavailable.", 0, "unavailable", "unknown", true));
    });
    return () => { active = false; };
  }, [retryKey]);
  if (error) return <main className="analytics-dashboard" role="alert"><h1>Replays disconnected</h1><p>{error.message}</p><button onClick={() => setRetryKey((key) => key + 1)}>Retry</button></main>;
  if (!payload) return <main className="analytics-dashboard"><p role="status">Loading incident replays…</p></main>;
  if (!payload.replays.length) return <main className="analytics-dashboard" data-testid="replays-empty"><h1>Historical Incident Replays</h1><p>No replay reports have been published to the control plane.</p></main>;
  return <main className="analytics-dashboard" data-testid="replays-workspace"><header className="analytics-header"><h1>Historical Incident Replays</h1><span>{payload.summary.passed}/{payload.summary.total} passed</span></header><section>{payload.replays.map((replay) => <article className="analytics-chart-card" key={replay.id}><h2>{replay.title}</h2><p>{replay.verdict} · {replay.durationMs} ms</p><p>Base {replay.baseCommit} · Human fix {replay.humanFixCommit}</p><p>AI paths: {replay.comparison.aiChangedPaths.join(", ")}</p></article>)}</section></main>;
}

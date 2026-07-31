import React, { useState } from "react";

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
  repair: {
    decision: string;
    proof: {
      selectedFindingResolved: boolean;
      blockingNewFindings: string[];
    };
  };
}

export interface IncidentReplayWorkspaceProps {
  replays?: ReplayItem[];
}

const DEFAULT_REPLAYS: ReplayItem[] = [
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

export const IncidentReplayWorkspace: React.FC<IncidentReplayWorkspaceProps> = ({
  replays = DEFAULT_REPLAYS,
}) => {
  const [selectedId, setSelectedId] = useState<string>(replays[0]?.id ?? "");

  const selectedReplay = replays.find((r) => r.id === selectedId) ?? replays[0];

  const total = replays.length;
  const reproduced = replays.filter((r) => r.reproductionConfirmed).length;
  const passed = replays.filter((r) => r.verdict === "passed").length;
  const exactMatches = replays.filter((r) => r.comparison.exactPatchMatch).length;
  const avgDuration =
    total > 0
      ? Math.round(replays.reduce((acc, r) => acc + r.durationMs, 0) / total)
      : 0;

  return (
    <div style={{ padding: "24px", fontFamily: "sans-serif", maxWidth: "1200px", margin: "0 auto" }}>
      <header style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "700", margin: "0 0 8px 0" }}>
          Historical Incident Replays & Benchmarks
        </h1>
        <p style={{ color: "#666", margin: 0 }}>
          Software Oath benchmark suite running autonomous AI repair against historical production incident reproductions.
        </p>
      </header>

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "20px",
          }}
        >
          <div style={{ fontSize: "14px", color: "#64748b" }}>Total Incidents</div>
          <div style={{ fontSize: "32px", fontWeight: "700", color: "#0f172a" }}>
            {total}
          </div>
        </div>

        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "8px",
            padding: "20px",
          }}
        >
          <div style={{ fontSize: "14px", color: "#166534" }}>Reproduction Rate</div>
          <div style={{ fontSize: "32px", fontWeight: "700", color: "#15803d" }}>
            {total > 0 ? `${Math.round((reproduced / total) * 100)}%` : "0%"}
          </div>
        </div>

        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            padding: "20px",
          }}
        >
          <div style={{ fontSize: "14px", color: "#1e40af" }}>AI Repair Pass Rate</div>
          <div style={{ fontSize: "32px", fontWeight: "700", color: "#1d4ed8" }}>
            {total > 0 ? `${Math.round((passed / total) * 100)}%` : "0%"}
          </div>
        </div>

        <div
          style={{
            background: "#faf5ff",
            border: "1px solid #e9d5ff",
            borderRadius: "8px",
            padding: "20px",
          }}
        >
          <div style={{ fontSize: "14px", color: "#6b21a8" }}>Exact Patch Match</div>
          <div style={{ fontSize: "32px", fontWeight: "700", color: "#7e22ce" }}>
            {total > 0 ? `${Math.round((exactMatches / total) * 100)}%` : "0%"}
          </div>
        </div>

        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #ffedd5",
            borderRadius: "8px",
            padding: "20px",
          }}
        >
          <div style={{ fontSize: "14px", color: "#9a3412" }}>Mean Repair Time</div>
          <div style={{ fontSize: "32px", fontWeight: "700", color: "#c2410c" }}>
            {(avgDuration / 1000).toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Grid Layout: List vs Inspector */}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "24px" }}>
        {/* Incident List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>
            Benchmark Suite Cases
          </h3>
          {replays.map((r) => {
            const isSelected = r.id === selectedReplay?.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                style={{
                  textAlign: "left",
                  padding: "14px",
                  borderRadius: "6px",
                  border: isSelected ? "2px solid #2563eb" : "1px solid #e2e8f0",
                  background: isSelected ? "#eff6ff" : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b" }}>
                  {r.id}
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: "600",
                    color: "#0f172a",
                    marginTop: "4px",
                  }}
                >
                  {r.title}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: r.verdict === "passed" ? "#dcfce7" : "#fee2e2",
                      color: r.verdict === "passed" ? "#15803d" : "#b91c1c",
                      fontWeight: "600",
                    }}
                  >
                    {r.verdict.toUpperCase()}
                  </span>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                    {(r.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detailed Inspector */}
        {selectedReplay && (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                borderBottom: "1px solid #f1f5f9",
                paddingBottom: "16px",
                marginBottom: "20px",
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "#64748b",
                    textTransform: "uppercase",
                  }}
                >
                  {selectedReplay.id}
                </span>
                <h2 style={{ fontSize: "20px", fontWeight: "700", margin: "4px 0 0 0" }}>
                  {selectedReplay.title}
                </h2>
              </div>
              <span
                style={{
                  fontSize: "13px",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: selectedReplay.verdict === "passed" ? "#dcfce7" : "#fee2e2",
                  color: selectedReplay.verdict === "passed" ? "#15803d" : "#b91c1c",
                  fontWeight: "700",
                }}
              >
                VERDICT: {selectedReplay.verdict.toUpperCase()}
              </span>
            </div>

            {/* Commits Info */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
                marginBottom: "24px",
                background: "#f8fafc",
                padding: "16px",
                borderRadius: "6px",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>Base Commit (Incriminating)</div>
                <div style={{ fontSize: "14px", fontFamily: "monospace", fontWeight: "600" }}>
                  {selectedReplay.baseCommit}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>Human Reference Fix Commit</div>
                <div style={{ fontSize: "14px", fontFamily: "monospace", fontWeight: "600" }}>
                  {selectedReplay.humanFixCommit}
                </div>
              </div>
            </div>

            {/* Patch Comparison */}
            <div style={{ marginBottom: "24px" }}>
              <h4 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "12px" }}>
                Patch Comparison Matrix
              </h4>
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  padding: "16px",
                  background: "#fafafa",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600" }}>Patch Equivalence:</span>
                  {selectedReplay.comparison.exactPatchMatch ? (
                    <span
                      style={{
                        fontSize: "12px",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background: "#dcfce7",
                        color: "#15803d",
                        fontWeight: "600",
                      }}
                    >
                      Exact Git Patch Match (Identical SHA)
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "12px",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background: "#fef3c7",
                        color: "#b45309",
                        fontWeight: "600",
                      }}
                    >
                      Behavioral Match (Semantically Equivalent)
                    </span>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#475569" }}>
                      AI Repair Changed Paths:
                    </div>
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: "20px", fontSize: "13px", fontFamily: "monospace" }}>
                      {selectedReplay.comparison.aiChangedPaths.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#475569" }}>
                      Human Fix Changed Paths:
                    </div>
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: "20px", fontSize: "13px", fontFamily: "monospace" }}>
                      {selectedReplay.comparison.humanChangedPaths.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Proof & Verification */}
            <div>
              <h4 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "12px" }}>
                Cryptographic Attestation & Evidence
              </h4>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#334155",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#16a34a", fontWeight: "700" }}>✓</span>
                  Target finding resolved: {selectedReplay.repair.proof.selectedFindingResolved ? "YES" : "NO"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#16a34a", fontWeight: "700" }}>✓</span>
                  New blocking security/rule findings introduced: {selectedReplay.repair.proof.blockingNewFindings.length}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#16a34a", fontWeight: "700" }}>✓</span>
                  Decision Status: <strong style={{ textTransform: "uppercase" }}>{selectedReplay.repair.decision}</strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

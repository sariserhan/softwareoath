import {
  GitBranch,
  Shield,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiClient } from "../api/client";
import type { RepositoryRegistration } from "../control-plane/types";

export function SettingsView() {
  const [repositories, setRepositories] = useState<RepositoryRegistration[]>([]);
  const [selectedRepository, setSelectedRepository] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void apiClient
      .get<{ repositories: RepositoryRegistration[] }>("/api/repositories")
      .then(({ repositories: loaded }) => {
        if (!active) return;
        setRepositories(loaded);
        setSelectedRepository((current) =>
          loaded.some(({ repository }) => repository === current)
            ? current
            : (loaded[0]?.repository ?? ""),
        );
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(
                cause instanceof Error ? cause.message : "Settings unavailable.",
                0,
                "unavailable",
                "unknown",
                true,
              ),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const registration = repositories.find(
    ({ repository }) => repository === selectedRepository,
  );

  if (loading) {
    return (
      <main className="analytics-dashboard" data-testid="settings-loading">
        <h2>Settings</h2>
        <p role="status">Loading repository settings…</p>
      </main>
    );
  }

  if (error) {
    const denied = error.kind === "permission_denied";
    return (
      <main className="analytics-dashboard" data-testid="settings-error">
        <h2>{denied ? "Settings permission denied" : "Settings disconnected"}</h2>
        <p>{error.message}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setError(undefined);
            setReloadKey((key) => key + 1);
          }}
        >
          Retry
        </button>
      </main>
    );
  }

  if (!registration) {
    return (
      <main className="analytics-dashboard" data-testid="settings-empty">
        <h2>Settings</h2>
        <p>No repositories are connected. Connect a repository to configure stewardship.</p>
      </main>
    );
  }

  return (
    <main className="analytics-dashboard" data-testid="settings-view">
      <header className="analytics-header">
        <h2>Settings</h2>
        <span className="analytics-subtitle">
          Configure stewardship behavior for {registration.repository}
        </span>
      </header>

      <section className="analytics-charts-grid">
        <div className="analytics-chart-card">
          <div className="analytics-chart-header">
            <h3><GitBranch size={16} /> Repository</h3>
          </div>
          <div className="analytics-bar-list">
            <div className="analytics-bar-row" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "120px" }}>Repository</span>
              <select
                aria-label="Repository"
                value={selectedRepository}
                onChange={(event) => setSelectedRepository(event.target.value)}
              >
                {repositories.map(({ repository }) => (
                  <option key={repository} value={repository}>{repository}</option>
                ))}
              </select>
            </div>
            <div className="analytics-bar-row" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "120px" }}>Default Branch</span>
              <span style={{ fontSize: "0.82rem", color: "var(--text)" }}>{registration.defaultBranch}</span>
            </div>
            <div className="analytics-bar-row" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "120px" }}>Engine Version</span>
              <span style={{ fontSize: "0.82rem", color: "var(--text)" }}>v0.1.0</span>
            </div>
          </div>
        </div>

        <div className="analytics-chart-card">
          <div className="analytics-chart-header">
            <h3><Shield size={16} /> Approval Policy</h3>
          </div>
          <div className="analytics-bar-list">
            <div className="analytics-bar-row" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "160px" }}>Package Updates</span>
              <span className="analytics-chart-badge">
                {registration.policy.allowMajorPackageUpdates ? "major updates allowed" : "major updates require review"}
              </span>
            </div>
            <div className="analytics-bar-row" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "160px" }}>Auto-Merge</span>
              <span className="analytics-chart-badge" style={{ color: "var(--red)" }}>
                {registration.policy.automaticMerge ? "enabled" : "disabled"}
              </span>
            </div>
          </div>
        </div>

        <div className="analytics-chart-card">
          <div className="analytics-chart-header">
            <h3><GitBranch size={16} /> Scan Schedule</h3>
          </div>
          <div className="analytics-bar-list">
            <div className="analytics-bar-row"><span style={{ width: 160 }}>Mode</span><span>{registration.schedule.mode}</span></div>
            <div className="analytics-bar-row"><span style={{ width: 160 }}>Timezone</span><span>{registration.schedule.timezone}</span></div>
            <div className="analytics-bar-row"><span style={{ width: 160 }}>Next scan</span><span>{registration.nextRunAt ? new Date(registration.nextRunAt).toLocaleString() : "Not scheduled"}</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}

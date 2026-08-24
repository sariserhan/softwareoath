import {
  Bell,
  GitBranch,
  Key,
  Shield,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiClient } from "../api/client";
import type { RepositoryRegistration } from "../control-plane/types";

interface SettingToggleProps {
  label: string;
  description: string;
  defaultChecked?: boolean;
}

function SettingToggle({ label, description, defaultChecked = false }: SettingToggleProps) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label className="analytics-bar-row" style={{ cursor: "pointer", padding: "12px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.85rem", color: "var(--text)", fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: "0.72rem", color: "var(--dim)", marginTop: "2px" }}>{description}</div>
      </div>
      <div
        onClick={() => setChecked(!checked)}
        style={{
          width: "40px",
          height: "22px",
          borderRadius: "11px",
          background: checked ? "var(--accent)" : "var(--border)",
          position: "relative",
          cursor: "pointer",
          transition: "background 200ms ease",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "var(--text)",
            position: "absolute",
            top: "3px",
            left: checked ? "21px" : "3px",
            transition: "left 200ms ease",
          }}
        />
      </div>
    </label>
  );
}

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
            <h3><Bell size={16} /> Notifications & Schedule</h3>
          </div>
          <div className="analytics-bar-list" style={{ borderTop: "1px solid var(--border-soft)", paddingTop: "8px" }}>
            <SettingToggle
              label="Scheduled Scans"
              description="Run automated stewardship scans on a weekly schedule"
              defaultChecked={registration.schedule.mode !== "disabled"}
            />
            <SettingToggle
              label="Slack Notifications"
              description="Send repair results to a Slack channel"
              defaultChecked={false}
            />
            <SettingToggle
              label="Email Digest"
              description="Send weekly summary email to repository owners"
              defaultChecked={false}
            />
          </div>
        </div>

        <div className="analytics-chart-card">
          <div className="analytics-chart-header">
            <h3><Key size={16} /> Security & API</h3>
          </div>
          <div className="analytics-bar-list" style={{ borderTop: "1px solid var(--border-soft)", paddingTop: "8px" }}>
            <SettingToggle
              label="Ed25519 Receipt Signing"
              description="Cryptographically sign all repair receipts"
              defaultChecked={true}
            />
            <SettingToggle
              label="Sentry Webhook Ingestion"
              description="Accept HMAC-signed Sentry alerts as incident signals"
              defaultChecked={false}
            />
            <SettingToggle
              label="GitHub App Integration"
              description="Open draft PRs via GitHub App with split permissions"
              defaultChecked={true}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

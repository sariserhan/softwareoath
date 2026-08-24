import {
  Bell,
  GitBranch,
  Key,
  Shield,
} from "lucide-react";
import { useState } from "react";

import { demoOath } from "../data/demo";

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
  return (
    <main className="analytics-dashboard" data-testid="settings-view">
      <header className="analytics-header">
        <h2>Settings</h2>
        <span className="analytics-subtitle">
          Configure stewardship behavior for {demoOath.application.repository}
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
              <span style={{ fontSize: "0.82rem", color: "var(--text)" }}>{demoOath.application.repository}</span>
            </div>
            <div className="analytics-bar-row" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "120px" }}>Default Branch</span>
              <span style={{ fontSize: "0.82rem", color: "var(--text)" }}>{demoOath.application.defaultBranch}</span>
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
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "160px" }}>Human Review For</span>
              <span className="analytics-chart-badge">critical</span>
            </div>
            <div className="analytics-bar-row" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)", width: "160px" }}>Auto-Merge</span>
              <span className="analytics-chart-badge" style={{ color: "var(--red)" }}>disabled</span>
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
              defaultChecked={true}
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

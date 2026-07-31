import {
  AlertTriangle,
  Check,
  FileCode,
  LockKeyhole,
  Shield,
} from "lucide-react";

import { demoOath, demoReport } from "../data/demo";

export function ConstitutionView() {
  const passedCount = demoReport.rules.filter((r) => r.status === "passed").length;
  const reviewCount = demoReport.rules.filter((r) => r.status === "human_review").length;

  return (
    <main className="analytics-dashboard" data-testid="constitution-view">
      <header className="analytics-header">
        <h2>Constitution</h2>
        <span className="analytics-subtitle">
          {demoOath.application.name} — declared rules and verification status
        </span>
      </header>

      <section className="analytics-kpi-grid" style={{ marginBottom: "24px" }}>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon">
            <Shield size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Version</span>
            <span className="analytics-kpi-value">v{demoOath.version}</span>
          </div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon">
            <Check size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Passed</span>
            <span className="analytics-kpi-value">{passedCount}</span>
          </div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
            <AlertTriangle size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Human Review</span>
            <span className="analytics-kpi-value">{reviewCount}</span>
          </div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon">
            <FileCode size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Source</span>
            <span className="analytics-kpi-value" style={{ fontSize: "0.85rem" }}>software-oath.yml</span>
          </div>
        </div>
      </section>

      <section>
        {demoReport.rules.map(({ rule, status, reason }) => (
          <div
            key={rule.id}
            className="analytics-chart-card"
            style={{ marginBottom: "12px" }}
          >
            <div className="analytics-chart-header">
              <h3>
                {status === "passed" ? (
                  <Check size={16} style={{ color: "var(--accent)" }} />
                ) : (
                  <AlertTriangle size={16} style={{ color: "var(--amber)" }} />
                )}
                {rule.title}
              </h3>
              <span className="analytics-chart-badge">
                {rule.severity}
              </span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "var(--muted)" }}>
              {rule.description}
            </p>
            <div style={{ display: "flex", gap: "16px", fontSize: "0.75rem", color: "var(--dim)" }}>
              <span><strong>Status:</strong> {status === "passed" ? "Passed" : "Human Review"}</span>
              <span><strong>ID:</strong> {rule.id}</span>
              {rule.repair?.automaticCandidate && (
                <span>
                  <LockKeyhole size={12} style={{ verticalAlign: "middle" }} /> Automatic candidate
                </span>
              )}
            </div>
            {status === "human_review" && reason && (
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--amber)" }}>
                ⚠ {reason}
              </p>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  FileWarning,
  GitBranch,
  Shield,
} from "lucide-react";

import { demoOath, demoReport } from "../data/demo";

export function OverviewDashboard() {
  const passedCount = demoReport.rules.filter((r) => r.status === "passed").length;
  const reviewCount = demoReport.rules.filter((r) => r.status === "human_review").length;
  const totalRules = demoReport.rules.length;

  return (
    <main className="analytics-dashboard" data-testid="overview-dashboard">
      <header className="analytics-header">
        <h2>Overview</h2>
        <span className="analytics-subtitle">
          {demoOath.application.name} · {demoOath.application.repository}
        </span>
      </header>

      <section className="analytics-kpi-grid">
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon">
            <Shield size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Constitution</span>
            <span className="analytics-kpi-value">v{demoOath.version}</span>
            <span className="analytics-kpi-trend">
              {totalRules} rules declared
            </span>
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon">
            <CheckCircle2 size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Rules Passed</span>
            <span className="analytics-kpi-value">{passedCount}/{totalRules}</span>
            <span className="analytics-kpi-trend trend-up">
              <ArrowUpRight size={13} />
              {((passedCount / totalRules) * 100).toFixed(0)}% pass rate
            </span>
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
            <AlertTriangle size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Human Review</span>
            <span className="analytics-kpi-value">{reviewCount}</span>
            <span className="analytics-kpi-trend">
              items awaiting owner decision
            </span>
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="analytics-kpi-icon">
            <GitBranch size={20} strokeWidth={1.7} />
          </div>
          <div className="analytics-kpi-content">
            <span className="analytics-kpi-label">Default Branch</span>
            <span className="analytics-kpi-value">{demoOath.application.defaultBranch}</span>
            <span className="analytics-kpi-trend">
              monitored continuously
            </span>
          </div>
        </div>
      </section>

      <section className="analytics-charts-grid">
        <div className="analytics-chart-card">
          <div className="analytics-chart-header">
            <h3><BookOpenCheck size={16} /> Constitution Rules</h3>
            <span className="analytics-chart-badge">{totalRules} total</span>
          </div>
          <div className="analytics-bar-list">
            {demoReport.rules.map(({ rule, status }) => (
              <div className="analytics-bar-row" key={rule.id}>
                <span className="analytics-bar-label" style={{ width: "auto", flex: "0 0 auto" }}>
                  {status === "passed" ? (
                    <CheckCircle2 size={14} style={{ color: "var(--accent)" }} />
                  ) : (
                    <AlertTriangle size={14} style={{ color: "var(--amber)" }} />
                  )}
                </span>
                <span style={{ flex: 1, fontSize: "0.82rem", color: "var(--text)" }}>
                  {rule.title}
                </span>
                <span className="analytics-chart-badge">
                  {rule.severity}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="analytics-chart-card">
          <div className="analytics-chart-header">
            <h3><Activity size={16} /> Recent Activity</h3>
            <span className="analytics-chart-badge">Last 24h</span>
          </div>
          <div className="analytics-bar-list">
            {[
              { label: "Stewardship scans completed", count: 3, icon: FileWarning },
              { label: "Findings detected", count: 7, icon: AlertTriangle },
              { label: "Repairs verified", count: 2, icon: CheckCircle2 },
              { label: "Awaiting human review", count: 1, icon: Clock },
            ].map((item) => (
              <div className="analytics-bar-row" key={item.label}>
                <span className="analytics-bar-label" style={{ width: "auto", flex: "0 0 auto" }}>
                  <item.icon size={14} style={{ color: "var(--muted)" }} />
                </span>
                <span style={{ flex: 1, fontSize: "0.82rem", color: "var(--text)" }}>
                  {item.label}
                </span>
                <span className="analytics-bar-count">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

import {
  Activity, AlertTriangle, ArrowUpRight, BookOpenCheck, CheckCircle2,
  Clock, FileWarning, GitBranch, Shield,
} from "lucide-react";

import { useDashboardData } from "./DashboardData.js";

export function OverviewDashboard() {
  const { repository, runs, review, loading, stale, error, reviewError, retry } =
    useDashboardData();
  if (loading) return <main className="analytics-dashboard"><p role="status">Loading overview…</p></main>;
  if (error && !repository) return (
    <main className="analytics-dashboard" role="alert"><h2>Overview disconnected</h2><p>{error.message}</p><button onClick={retry}>Retry</button></main>
  );
  if (!repository) return (
    <main className="analytics-dashboard" data-testid="overview-empty"><h2>Overview</h2><p>Connect a repository to see its stewardship overview.</p></main>
  );
  const report = review?.receipt.verification.report;
  const rules = report?.rules ?? [];
  const passedCount = report?.summary.passed ?? 0;
  const reviewCount = report?.summary.humanReview ?? 0;
  const totalRules = rules.length;
  const completed = runs.filter(({ status }) => status === "completed").length;
  const blocked = runs.filter(({ status }) => status === "blocked" || status === "ci_failed").length;
  const awaiting = runs.filter(({ status }) => status === "awaiting_approval").length;

  return (
    <main className="analytics-dashboard" data-testid="overview-dashboard">
      <header className="analytics-header"><h2>Overview</h2><span className="analytics-subtitle">{repository.repository}</span></header>
      {stale ? <p role="status">Showing stale data while the control plane reconnects.</p> : null}
      {reviewError ? <p role="alert">Latest verification unavailable: {reviewError.message}</p> : null}
      <section className="analytics-kpi-grid">
        <div className="analytics-kpi-card"><div className="analytics-kpi-icon"><Shield size={20} /></div><div className="analytics-kpi-content"><span className="analytics-kpi-label">Constitution</span><span className="analytics-kpi-value">{report ? "v1" : "—"}</span><span className="analytics-kpi-trend">{totalRules} rules evaluated</span></div></div>
        <div className="analytics-kpi-card"><div className="analytics-kpi-icon"><CheckCircle2 size={20} /></div><div className="analytics-kpi-content"><span className="analytics-kpi-label">Rules Passed</span><span className="analytics-kpi-value">{passedCount}/{totalRules}</span><span className="analytics-kpi-trend trend-up"><ArrowUpRight size={13} />{totalRules ? ((passedCount / totalRules) * 100).toFixed(0) : 0}% pass rate</span></div></div>
        <div className="analytics-kpi-card"><div className="analytics-kpi-icon"><AlertTriangle size={20} /></div><div className="analytics-kpi-content"><span className="analytics-kpi-label">Human Review</span><span className="analytics-kpi-value">{reviewCount}</span><span className="analytics-kpi-trend">items awaiting owner decision</span></div></div>
        <div className="analytics-kpi-card"><div className="analytics-kpi-icon"><GitBranch size={20} /></div><div className="analytics-kpi-content"><span className="analytics-kpi-label">Default Branch</span><span className="analytics-kpi-value">{repository.defaultBranch}</span><span className="analytics-kpi-trend">monitored continuously</span></div></div>
      </section>
      <section className="analytics-charts-grid">
        <div className="analytics-chart-card"><div className="analytics-chart-header"><h3><BookOpenCheck size={16} /> Constitution Rules</h3><span className="analytics-chart-badge">{totalRules} total</span></div>
          {rules.length ? <div className="analytics-bar-list">{rules.map(({ rule, status }) => <div className="analytics-bar-row" key={rule.id}><span>{status === "passed" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}</span><span style={{ flex: 1 }}>{rule.title}</span><span className="analytics-chart-badge">{rule.severity}</span></div>)}</div> : <p>No completed verification receipt is available yet.</p>}
        </div>
        <div className="analytics-chart-card"><div className="analytics-chart-header"><h3><Activity size={16} /> Run Activity</h3><span className="analytics-chart-badge">Live</span></div><div className="analytics-bar-list">
          {[{ label: "Runs recorded", count: runs.length, icon: FileWarning }, { label: "Completed", count: completed, icon: CheckCircle2 }, { label: "Blocked or failed", count: blocked, icon: AlertTriangle }, { label: "Awaiting owner review", count: awaiting, icon: Clock }].map((item) => <div className="analytics-bar-row" key={item.label}><item.icon size={14} /><span style={{ flex: 1 }}>{item.label}</span><span className="analytics-bar-count">{item.count}</span></div>)}
        </div></div>
      </section>
    </main>
  );
}

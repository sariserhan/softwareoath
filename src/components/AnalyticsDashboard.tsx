import { Activity, AlertTriangle, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { useDashboardData } from "./DashboardData.js";

export function AnalyticsDashboard() {
  const { repository, runs, review, loading, stale, error, retry } = useDashboardData();
  if (loading) return <main className="analytics-dashboard"><p role="status">Loading analytics…</p></main>;
  if (error && !repository) return <main className="analytics-dashboard" role="alert"><h2>Analytics disconnected</h2><p>{error.message}</p><button onClick={retry}>Retry</button></main>;
  if (!repository) return <main className="analytics-dashboard" data-testid="analytics-empty"><h2>Stewardship Analytics</h2><p>Connect a repository to collect analytics.</p></main>;

  const terminal = runs.filter(({ status }) => ["completed", "blocked", "cancelled"].includes(status));
  const completed = runs.filter(({ status }) => status === "completed").length;
  const blocked = runs.filter(({ status }) => status === "blocked" || status === "ci_failed").length;
  const awaiting = runs.filter(({ status }) => status === "awaiting_approval").length;
  const passRate = terminal.length ? Math.round((completed / terminal.length) * 100) : 0;
  const durations = runs.map((run) => Date.parse(run.updatedAt) - Date.parse(run.createdAt)).filter((value) => value >= 0);
  const averageMinutes = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 60_000) : 0;
  const finding = review?.receipt.finding;
  const report = review?.receipt.verification.report;
  const counts = [
    { label: "Completed", count: completed, icon: CheckCircle2 },
    { label: "Awaiting decision", count: awaiting, icon: Clock },
    { label: "Blocked / CI failed", count: blocked, icon: AlertTriangle },
    { label: "Active verified finding", count: finding ? 1 : 0, icon: ShieldCheck },
  ];

  return (
    <main className="analytics-dashboard" data-testid="analytics-dashboard">
      <header className="analytics-header"><h2>Stewardship Analytics</h2><span className="analytics-subtitle">Live control-plane metrics for {repository.repository}</span></header>
      {stale ? <p role="status">Analytics are stale while the control plane reconnects.</p> : null}
      <section className="analytics-kpi-grid">
        {[{ label: "Total Runs", value: String(runs.length), icon: Activity }, { label: "Pass Rate", value: `${passRate}%`, icon: CheckCircle2 }, { label: "Avg MTTR", value: `${averageMinutes}m`, icon: Clock }, { label: "Active Findings", value: String(finding ? 1 : 0), icon: AlertTriangle }].map(({ label, value, icon: Icon }) => <div className="analytics-kpi-card" key={label}><div className="analytics-kpi-icon"><Icon size={20} /></div><div className="analytics-kpi-content"><span className="analytics-kpi-label">{label}</span><span className="analytics-kpi-value">{value}</span></div></div>)}
      </section>
      <section className="analytics-charts-grid">
        <div className="analytics-chart-card"><div className="analytics-chart-header"><h3>Run Outcomes</h3><span className="analytics-chart-badge">All recorded runs</span></div><div className="analytics-bar-list">{counts.map(({ label, count, icon: Icon }) => <div className="analytics-bar-row" key={label}><Icon size={14} /><span style={{ flex: 1 }}>{label}</span><span className="analytics-bar-count">{count}</span></div>)}</div></div>
        <div className="analytics-chart-card"><div className="analytics-chart-header"><h3>Latest Verification</h3><span className="analytics-chart-badge">Verified receipt</span></div>{report ? <div className="analytics-bar-list"><div className="analytics-bar-row"><span style={{ flex: 1 }}>Rules passed</span><span>{report.summary.passed}</span></div><div className="analytics-bar-row"><span style={{ flex: 1 }}>Rules failed</span><span>{report.summary.failed}</span></div><div className="analytics-bar-row"><span style={{ flex: 1 }}>Human review</span><span>{report.summary.humanReview}</span></div><div className="analytics-bar-row"><span style={{ flex: 1 }}>Finding category</span><span>{finding?.category ?? "none"}</span></div></div> : <p>No verified receipt is available yet.</p>}</div>
      </section>
    </main>
  );
}

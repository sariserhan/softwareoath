import { AlertTriangle, Check, FileCode, LockKeyhole, Shield } from "lucide-react";
import { useDashboardData } from "./DashboardData";

export function ConstitutionView() {
  const { repository, review, loading, error, reviewError, retry } = useDashboardData();
  if (loading) return <main className="analytics-dashboard"><p role="status">Loading constitution…</p></main>;
  if (error && !repository) return <main className="analytics-dashboard" role="alert"><h2>Constitution disconnected</h2><p>{error.message}</p><button onClick={retry}>Retry</button></main>;
  if (!repository) return <main className="analytics-dashboard" data-testid="constitution-empty"><h2>Constitution</h2><p>Connect a repository to inspect its constitution.</p></main>;
  const report = review?.receipt.verification.report;
  if (!report) return <main className="analytics-dashboard" data-testid="constitution-pending"><h2>Constitution</h2><p>{reviewError?.message ?? "No completed verification receipt is available yet."}</p></main>;
  return (
    <main className="analytics-dashboard" data-testid="constitution-view">
      <header className="analytics-header"><h2>Constitution</h2><span className="analytics-subtitle">{repository.repository} — declared rules and verification status</span></header>
      <section className="analytics-kpi-grid" style={{ marginBottom: 24 }}>
        {[{ label: "Version", value: "v1", icon: Shield }, { label: "Passed", value: String(report.summary.passed), icon: Check }, { label: "Human Review", value: String(report.summary.humanReview), icon: AlertTriangle }, { label: "Source", value: "software-oath.yml", icon: FileCode }].map(({ label, value, icon: Icon }) => <div className="analytics-kpi-card" key={label}><div className="analytics-kpi-icon"><Icon size={20} /></div><div className="analytics-kpi-content"><span className="analytics-kpi-label">{label}</span><span className="analytics-kpi-value" style={label === "Source" ? { fontSize: ".85rem" } : undefined}>{value}</span></div></div>)}
      </section>
      <section>{report.rules.map(({ rule, status, reason }) => <div key={rule.id} className="analytics-chart-card" style={{ marginBottom: 12 }}><div className="analytics-chart-header"><h3>{status === "passed" ? <Check size={16} /> : <AlertTriangle size={16} />}{rule.title}</h3><span className="analytics-chart-badge">{rule.severity}</span></div><p>{rule.description}</p><div><strong>Status:</strong> {status === "passed" ? "Passed" : status === "failed" ? "Failed" : "Human Review"} · <strong>ID:</strong> {rule.id}{rule.repair?.automaticCandidate ? <span> · <LockKeyhole size={12} /> Automatic candidate</span> : null}</div>{reason ? <p>{reason}</p> : null}</div>)}</section>
    </main>
  );
}

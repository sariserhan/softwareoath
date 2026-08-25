import { Activity, AlertTriangle, ArrowRight, BookOpenCheck, CheckCircle2, CircleDollarSign, CircleHelp, GitBranch, History, Play, ShieldCheck, Wrench } from "lucide-react";
import { useDashboardData } from "./DashboardData.js";

const labels: Record<string, string> = { awaiting_approval: "Awaiting owner review", blocked: "Blocked", ci_failed: "CI failed", completed: "Completed", running: "Running", queued: "Queued", cancelled: "Cancelled" };
const displayStatus = (status: string) => labels[status] ?? status.replaceAll("_", " ");

export function OverviewDashboard({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { repository, runs, review, reviewer, loading, stale, error, reviewError, retry } = useDashboardData();
  if (loading) return <main className="command-center"><p role="status">Loading command center…</p></main>;
  if (error && !repository) return <main className="command-center" role="alert"><h1>Command center disconnected</h1><p>{error.message}</p><button className="command-primary" onClick={retry}>Retry connection</button></main>;

  const report = review?.receipt.verification.report;
  const awaiting = runs.filter(({ status }) => status === "awaiting_approval").length;
  const blocked = runs.filter(({ status }) => status === "blocked" || status === "ci_failed").length;
  const cost = review?.receipt.cost;
  const recentRuns = runs.slice(0, 4);
  const products = [
    { icon: ShieldCheck, name: "Repository Steward", description: "Review bounded repairs and the evidence behind every proposed change.", status: awaiting ? awaiting + " awaiting review" : runs.length ? "Ready" : "No incidents yet", detail: runs.length ? runs.length + " runs recorded" : "Start with a stewardship scan", action: "Review incidents", view: "Incidents" },
    { icon: Wrench, name: "Dependency Optimizer", description: "Find costly, risky, duplicated, or outdated dependencies.", status: "Ready", detail: "Analysis stays owner-controlled", action: "Analyze dependencies", view: "Optimizer" },
    { icon: History, name: "Incident Replay", description: "Reproduce incidents and validate repairs against captured evidence.", status: "Ready", detail: "Replay evidence is preserved", action: "Open replay workspace", view: "Replays" },
    { icon: CircleDollarSign, name: "Cost Analysis", description: "Compare infrastructure cost before and after a proposed repair.", status: cost ? cost.status.replaceAll("_", " ") : "Not available yet", detail: cost ? String(cost.baselineMonthlyCost ?? "—") + " → " + String(cost.proposedMonthlyCost ?? "—") + " " + cost.currency + " monthly" : "Available after the first completed repair", action: "View cost evidence", view: "Incidents" },
  ];
  const readiness = [
    { label: "Repository connection", ready: Boolean(repository), detail: repository ? "Connected" : "Required", view: "Connect" },
    { label: "Constitution", ready: Boolean(report), detail: report ? report.rules.length + " rules evaluated" : "Awaiting first evidence", view: "Constitution" },
    { label: "Knowledge base", ready: Boolean(repository), detail: repository ? "Workspace available" : "Connect first", view: "Knowledge" },
    { label: "GitHub authorization", ready: Boolean(reviewer), detail: reviewer ? "@" + reviewer.login : "Sign in required", view: "Connect" },
    { label: "First stewardship scan", ready: runs.length > 0, detail: runs.length ? "Complete" : "Not run yet", view: "Connect" },
  ];

  return <main className="command-center" data-testid="overview-dashboard">
    <header className="command-header"><div><h1>Repository command center</h1><p><GitBranch aria-hidden="true" size={13}/>{repository?.repository ?? "No repository connected"}<span>{repository?.defaultBranch ?? "—"}</span></p></div><button className="command-primary" onClick={() => onNavigate("Connect")}><Play aria-hidden="true" size={14}/>Run stewardship scan</button></header>
    {stale ? <p className="command-notice" role="status">Showing saved data while the control plane reconnects.</p> : null}
    {reviewError ? <p className="command-notice" role="alert">Latest evidence is temporarily unavailable: {reviewError.message}</p> : null}
    <section className="attention-rail" aria-label="Repository attention summary">
      <div><ShieldCheck size={19}/><span><strong>{awaiting}</strong>Awaiting owner review<small>{awaiting ? "Decision required" : "No items waiting"}</small></span></div>
      <div><AlertTriangle size={19}/><span><strong>{blocked}</strong>Blocked or failed<small>{blocked ? "Review run evidence" : "All systems go"}</small></span></div>
      <div><CircleHelp size={19}/><span><strong>{report?.summary.humanReview ?? 0}</strong>Needs attention<small>{report?.summary.humanReview ? "Human review required" : "No open review items"}</small></span></div>
      <div><BookOpenCheck size={19}/><span><strong>{report ? report.summary.passed + " passed" : "No evidence yet"}</strong>Latest evidence<small>{runs[0] ? displayStatus(runs[0].status) : "Run your first scan"}</small></span></div>
    </section>
    <section className="workflow-section"><div className="command-section-title"><h2>Products and workflows</h2><p>Everything Software Oath can do for this repository.</p></div><div className="workflow-list">{products.map(({icon: Icon, ...item}) => <button className="workflow-row" key={item.name} onClick={() => onNavigate(item.view)}><span className="workflow-icon"><Icon size={18}/></span><span className="workflow-name"><strong>{item.name}</strong><small>{item.description}</small></span><span className="workflow-status"><strong>{item.status}</strong><small>{item.detail}</small></span><span className="workflow-action">{item.action}<ArrowRight size={15}/></span></button>)}</div></section>
    <div className="command-lower-grid">
      <section className="command-panel"><div className="command-section-title"><h2>Recent activity</h2><button onClick={() => onNavigate("Runs")}>View all runs <ArrowRight size={14}/></button></div><div className="activity-list">{recentRuns.length ? recentRuns.map((run) => <button key={run.id} onClick={() => onNavigate("Runs")}><Activity size={16}/><span><strong>{run.id}</strong><small>{new Date(run.updatedAt).toLocaleString()}</small></span><span className="activity-status">{displayStatus(run.status)}</span><ArrowRight size={14}/></button>) : <div className="command-empty-row"><Activity size={17}/><span><strong>No activity yet</strong><small>Your stewardship scans and repair runs will appear here.</small></span></div>}</div></section>
      <section className="command-panel"><div className="command-section-title"><h2>Repository readiness</h2><p>What Software Oath needs to operate.</p></div><div className="readiness-list">{readiness.map((item) => <button key={item.label} onClick={() => onNavigate(item.view)}>{item.ready ? <CheckCircle2 className="is-ready" size={16}/> : <AlertTriangle size={16}/>}<span>{item.label}</span><small>{item.detail}</small><ArrowRight size={14}/></button>)}</div></section>
    </div>
  </main>;
}

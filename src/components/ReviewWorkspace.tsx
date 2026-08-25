import { ExternalLink, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";

import { apiClient } from "../api/client.js";
import type { FinalAttestation, HostedRunRecord } from "../control-plane/types.js";
import { useDashboardData } from "./DashboardData.js";

export function ReviewWorkspace() {
  const {
    runs, review, reviewer, csrfToken, loading, stale, error, reviewError,
    selectRun, retry, updateRun,
  } = useDashboardData();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (loading) return <main className="incident-canvas"><p role="status">Loading repair review…</p></main>;
  if (error && !runs.length) return <main className="incident-canvas" role="alert"><h1>Repair review disconnected</h1><p>{error.message}</p><button onClick={retry}>Retry</button></main>;
  if (!runs.length) return <main className="incident-canvas" data-testid="review-empty"><h1>No incidents yet</h1><p>Connect a repository and start a scan to create the first review.</p></main>;
  if (!review) return <main className="incident-canvas" data-testid="review-pending"><h1>Repair evidence unavailable</h1><p>{reviewError?.message ?? "The selected run has not produced a repair receipt yet."}</p><select aria-label="Repair run" onChange={(event) => selectRun(event.target.value)} value=""><option value="">Select a completed repair</option>{runs.filter(({ repairId }) => repairId).map(({ id }) => <option value={id} key={id}>{id}</option>)}</select><button onClick={retry}>Retry</button></main>;

  const { run, incident, receipt, patch, logs, attestation } = review;
  const report = receipt.verification.report;
  const approvalReady =
    run.status === "awaiting_approval" &&
    receipt.decision !== "blocked" &&
    receipt.cost?.status !== "blocked" &&
    receipt.proof.selectedFindingResolved &&
    receipt.proof.blockingNewFindings.length === 0 &&
    receipt.changes.withinAllowedScope &&
    review.receiptVerified;

  async function decide(decision: "approved" | "rejected") {
    if (!reason.trim() || !reviewer || !csrfToken) {
      setMessage("Sign in with GitHub and provide a written reason.");
      return;
    }
    if (decision === "approved" && !approvalReady) {
      setMessage("Approval is disabled until all verification and CI gates pass.");
      return;
    }
    setBusy(true);
    try {
      const payload = await apiClient.post<{
        run: HostedRunRecord;
        attestation: FinalAttestation;
      }>("/api/runs/" + encodeURIComponent(run.id) + "/decision", { decision, reason }, csrfToken);
      updateRun(payload.run);
      setMessage(`${decision === "approved" ? "Approval" : "Rejection"} recorded. Final attestation ${payload.attestation.id} verified.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Decision failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="incident-canvas" data-testid="review-workspace">
      <header className="incident-header"><div><h1>{incident.title}</h1><p>{receipt.finding.severity.toUpperCase()} · {receipt.finding.category} · {receipt.finding.title}</p><p>{receipt.finding.summary}</p></div>{stale ? <strong>Stale</strong> : null}</header>
      <section className="analytics-chart-card">
        <h2>Provenance and delivery</h2>
        <dl className="receipt"><div><dt>Incident</dt><dd>{incident.source} / {incident.externalId}</dd></div><div><dt>Base commit</dt><dd>{receipt.baseCommit}</dd></div><div><dt>Repair commit</dt><dd>{run.repairCommit ?? "Unavailable"}</dd></div><div><dt>Branch</dt><dd>{run.branch ?? "Unavailable"}</dd></div><div><dt>Agent</dt><dd>{receipt.agent.name} — {receipt.agent.summary}</dd></div><div><dt>Runner / image</dt><dd>{receipt.verification.execution.runner}</dd></div></dl>
        {run.pullRequestUrl ? <a href={run.pullRequestUrl} target="_blank" rel="noreferrer">Open draft pull request <ExternalLink size={14} /></a> : null}
      </section>
      <section className="analytics-chart-card"><h2>Patch and scope</h2><p>Changed files: {receipt.changes.files.join(", ") || "None"}</p><p>Allowed scope: {receipt.changes.withinAllowedScope ? "Passed" : "Failed"}</p><pre className="diff" aria-label="Full patch"><code>{patch}</code></pre></section>
      <section className="analytics-chart-card"><h2>Evidence and findings delta</h2><p>Selected finding resolved: {receipt.proof.selectedFindingResolved ? "Yes" : "No"}</p><p>Findings: {receipt.proof.before.total} before → {receipt.proof.after.total} after · {receipt.proof.newFindings.length} new · {receipt.proof.blockingNewFindings.length} blocking</p>{report.rules.flatMap(({ evidence, rule }) => evidence.map((item, index) => <div key={`${rule.id}-${index}`}><strong>{rule.title}: {item.status}</strong><p>{item.command ?? item.kind} · {item.durationMs ?? 0} ms</p><p>{item.summary}</p></div>))}</section>
      <section className="analytics-chart-card" aria-labelledby="cost-analysis-title"><h2 id="cost-analysis-title">Cost analysis</h2>{receipt.cost ? <><p><strong>{receipt.cost.provider} {receipt.cost.version}: {receipt.cost.status.replaceAll("_", " ")}</strong></p><dl className="receipt"><div><dt>Baseline</dt><dd>{receipt.cost.baselineMonthlyCost ?? "Unavailable"} {receipt.cost.currency}</dd></div><div><dt>Proposed</dt><dd>{receipt.cost.proposedMonthlyCost ?? "Unavailable"} {receipt.cost.currency}</dd></div><div><dt>Monthly change</dt><dd>{receipt.cost.monthlyCostChange ?? "Unavailable"} {receipt.cost.currency}</dd></div><div><dt>Percentage change</dt><dd>{receipt.cost.percentageChange ?? "Unavailable"}%</dd></div><div><dt>Resources</dt><dd>{receipt.cost.resources} across {receipt.cost.projects} project(s)</dd></div><div><dt>Runner</dt><dd>{receipt.cost.runner ?? "Unavailable"}</dd></div></dl><ul>{receipt.cost.reasons.map((item) => <li key={item}>{item}</li>)}</ul>{receipt.cost.unsupportedResources.length ? <p>Unsupported resources: {receipt.cost.unsupportedResources.join(", ")}</p> : null}{receipt.cost.artifacts ? <p>Raw evidence: baseline <code>{receipt.cost.artifacts.baselineSha256}</code> · proposed <code>{receipt.cost.artifacts.proposedSha256}</code></p> : null}</> : <p>Cost analysis is not enabled for this repository.</p>}</section>
      <section className="analytics-chart-card"><h2>CI and execution log</h2><p>CI gate: {run.status === "awaiting_approval" || run.status === "completed" ? "Passed" : run.status.replaceAll("_", " ")}</p>{logs.length ? <ol>{logs.map((log) => <li key={log.id}>{new Date(log.createdAt).toLocaleString()} — {log.message}</li>)}</ol> : <p>No execution logs recorded.</p>}</section>
      <section className="analytics-chart-card"><h2>Cryptographic receipt</h2><p><ShieldCheck size={16} /> Repair receipt verified</p><dl className="receipt"><div><dt>Receipt</dt><dd>{receipt.id}</dd></div><div><dt>Patch SHA-256</dt><dd>{receipt.changes.patchSha256}</dd></div><div><dt>Key</dt><dd>{receipt.signature.keyId}</dd></div><div><dt>Signature</dt><dd>{receipt.signature.value}</dd></div></dl>{attestation ? <p><ShieldCheck size={16} /> Final attestation {attestation.id} verified</p> : null}</section>
      <section className="approval-block"><h2>Owner decision</h2>{reviewer ? <p>Signed in as @{reviewer.login}. Live GitHub permission is rechecked at submission.</p> : <a href="/api/auth/github">Sign in with GitHub to decide</a>}<textarea aria-label="Decision reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this repair is safe or must be rejected." /><div className="decision-actions"><button disabled={busy || !reviewer || !reason.trim() || run.status !== "awaiting_approval"} onClick={() => void decide("rejected")}>Reject</button><button className="approve-button" disabled={busy || !reviewer || !reason.trim() || !approvalReady} onClick={() => void decide("approved")}>Approve pull request</button></div>{!approvalReady && run.status === "awaiting_approval" ? <p><ShieldX size={16} /> Approval blocked by incomplete or failed evidence.</p> : null}{run.status !== "awaiting_approval" ? <p>Decision closed: {run.status.replaceAll("_", " ")}.</p> : null}{message ? <p role="status">{message}</p> : null}</section>
    </main>
  );
}

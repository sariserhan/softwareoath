import {
  AlertCircle, AlertTriangle, Check, ChevronDown, CircleSlash2,
  Clock3, FileCode2, RefreshCw, Save, ShieldQuestion,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiError, apiClient } from "../api/client";
import { assessEmailCompatibility } from "../optimizer/email-catalog";
import { assessOperationalComplexity, estimateMigrationEffort } from "../optimizer/migration-estimate";
import { estimateEmailPricing } from "../optimizer/pricing";
import type { OptimizerAnalysisRecordV1 } from "../optimizer/types";
import { useDashboardData } from "./DashboardData";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function date(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function money(value?: number): string {
  return value === undefined ? "Unresolved" : "$" + value.toFixed(2);
}

function costRange(value?: { minimum: number; maximum: number }): string {
  return value ? `${money(value.minimum)} – ${money(value.maximum)}` : "Incomplete";
}

function StateView({ kind, retry }: { kind: string; retry?: () => void }) {
  const copy: Record<string, [string, string]> = {
    loading: ["Loading optimizer evidence", "Reading authorized analysis history."],
    error: ["Optimizer unavailable", "The control plane could not load optimizer evidence."],
    revoked: ["Repository access revoked", "Reconnect GitHub access before viewing private evidence."],
    deletion: ["No connected repository", "Connect a repository to create an optimizer evidence history."],
    unsupported: ["No supported dependency detected", "The latest analysis found no supported active service usage."],
    ambiguous: ["Service usage is ambiguous", "Owner confirmation is required before provider comparison."],
    empty: ["No optimizer analyses yet", "Run a connected stewardship scan to establish the first baseline."],
  };
  const [title, detail] = copy[kind] ?? copy.error;
  return <main className="optimizer-canvas optimizer-state" data-testid={`optimizer-${kind}`}>
    <ShieldQuestion aria-hidden="true" size={30} />
    <h1>{title}</h1><p>{detail}</p>
    {retry ? <button className="optimizer-button" onClick={retry} type="button"><RefreshCw size={14} />Try again</button> : null}
  </main>;
}

export function DependencyOptimizer() {
  const { repository, csrfToken, retry: retryShell } = useDashboardData();
  const [analyses, setAnalyses] = useState<OptimizerAnalysisRecordV1[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [volume, setVolume] = useState("");
  const [region, setRegion] = useState("");
  const [dedicatedIp, setDedicatedIp] = useState(false);
  const [requirements, setRequirements] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionCapabilities, setCorrectionCapabilities] = useState("");

  useEffect(() => {
    if (!repository) return;
    let active = true;
    apiClient.get<{ analyses: OptimizerAnalysisRecordV1[] }>(
      `/api/repositories/${encodeURIComponent(repository.repository)}/optimizer/analyses`,
    ).then(({ analyses: loaded }) => {
      if (!active) return;
      setAnalyses(loaded);
      setSelectedId((current) => current || loaded[0]?.id || "");
      const initial = loaded[0];
      if (initial) {
        setVolume(initial.ownerUsage?.monthlyVolume?.toString() ?? "");
        setRegion(initial.ownerUsage?.region ?? "");
        setDedicatedIp(initial.ownerUsage?.dedicatedIpRequired ?? false);
        setRequirements(initial.ownerUsage?.criticalOperationalRequirements?.join("\n") ?? "");
        setCorrectionCapabilities(initial.capabilities.map((item) => item.capabilityId).join(", "));
      }
      setError(undefined);
    }).catch((cause) => active && setError(cause instanceof ApiError ? cause : undefined))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [repository]);

  const selected = analyses.find((item) => item.id === selectedId) ?? analyses[0];
  function hydrateForm(analysis: OptimizerAnalysisRecordV1) {
    const usage = analysis.ownerUsage;
    setVolume(usage?.monthlyVolume?.toString() ?? "");
    setRegion(usage?.region ?? "");
    setDedicatedIp(usage?.dedicatedIpRequired ?? false);
    setRequirements(usage?.criticalOperationalRequirements?.join("\n") ?? "");
    setCorrectionCapabilities(analysis.capabilities.map((item) => item.capabilityId).join(", "));
  }

  function selectAnalysis(analysis: OptimizerAnalysisRecordV1) {
    setSelectedId(analysis.id);
    hydrateForm(analysis);
  }

  const comparison = useMemo(() => {
    if (!selected?.capabilities.length || !selected.ownerUsage) return [];
    return (["ses", "postmark"] as const).map((serviceId) => {
      const compatibility = assessEmailCompatibility({ targetServiceId: serviceId, capabilities: selected.capabilities });
      const price = estimateEmailPricing({ serviceId, usage: selected.ownerUsage! });
      const operations = assessOperationalComplexity({
        version: 1, targetServiceId: serviceId,
        deliveryEventsRequired: selected.capabilities.some((item) => item.capabilityId === "delivery_webhooks"),
        inboundEmailRequired: selected.capabilities.some((item) => item.capabilityId === "inbound_email"),
        dedicatedIpRequired: selected.ownerUsage!.dedicatedIpRequired ?? false,
        multipleRegionsRequired: false,
        ownerHourlyCost: selected.ownerUsage!.engineeringHourlyCost ?? 100,
      });
      const effort = estimateMigrationEffort({
        input: { version: 1, affectedFiles: new Set(selected.capabilities.flatMap((item) => item.evidence.map((evidence) => evidence.file))).size,
          changedCapabilities: compatibility.capabilities.filter((item) => item.support === "supported_with_changes").length,
          configurationChanges: 2, dnsChanges: 1, infrastructureChanges: serviceId === "ses" ? 2 : 0,
          dataMovement: selected.capabilities.some((item) => item.capabilityId === "contacts_audiences") ? "bounded" : "none",
          testingScope: "integration", rolloutComplexity: "staged", rollbackComplexity: "simple",
          ownerHourlyCost: selected.ownerUsage!.engineeringHourlyCost ?? 100 },
        operationalComplexity: operations,
      });
      return { serviceId, compatibility, price, operations, effort };
    });
  }, [selected]);

  async function saveUsage() {
    if (!selected || !repository) return;
    setBusy(true); setMessage("");
    try {
      const payload = await apiClient.post<{ analysis: OptimizerAnalysisRecordV1 }>(
        `/api/repositories/${encodeURIComponent(repository.repository)}/optimizer/analyses/${encodeURIComponent(selected.id)}/usage`,
        { monthlyVolume: Number(volume), region, dedicatedIpRequired: dedicatedIp,
          criticalOperationalRequirements: requirements.split("\n").map((item) => item.trim()).filter(Boolean) }, csrfToken,
      );
      setAnalyses((current) => current.map((item) => item.id === payload.analysis.id ? payload.analysis : item));
      setMessage("Owner inputs saved with audit evidence.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not save inputs."); }
    finally { setBusy(false); }
  }

  async function reportCorrection() {
    if (!selected || !repository || !selected.observations[0]) return;
    setBusy(true); setMessage("");
    try {
      const serviceId = selected.observations[0].serviceId;
      const payload = await apiClient.post<{ analysis: OptimizerAnalysisRecordV1 }>(
        `/api/repositories/${encodeURIComponent(repository.repository)}/optimizer/analyses/${encodeURIComponent(selected.id)}/observations/${encodeURIComponent(serviceId)}/decision`,
        { decision: "corrected", correctedStatus: "active",
          correctedCapabilityIds: correctionCapabilities.split(",").map((item) => item.trim()).filter(Boolean),
          reason: correctionReason }, csrfToken,
      );
      setAnalyses((current) => current.map((item) => item.id === payload.analysis.id ? payload.analysis : item));
      setMessage("Correction recorded without changing analyzer evidence."); setCorrectionReason("");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not record correction."); }
    finally { setBusy(false); }
  }

  if (loading) return <StateView kind="loading" />;
  if (!repository) return <StateView kind="deletion" />;
  if (error) return <StateView kind={error.kind === "permission_denied" || error.kind === "unauthenticated" ? "revoked" : "error"} retry={retryShell} />;
  if (!analyses.length) return <StateView kind="empty" />;
  if (!selected) return <StateView kind="error" />;
  if (selected.status === "failed") return <StateView kind="error" retry={() => location.reload()} />;
  const observation = selected.observations[0];
  if (!observation) return <StateView kind="unsupported" />;
  if (observation.status === "ambiguous") return <StateView kind="ambiguous" />;
  const unresolved = [...selected.unknowns, ...selected.warnings];
  const consequentialUnknowns = unresolved.length > 0 || comparison.some((item) =>
    item.compatibility.unknowns.length || !item.price.snapshot || item.price.snapshot.stale);
  const status = !selected.ownerUsage || consequentialUnknowns
    ? "INVESTIGATE"
    : comparison.some((item) => item.compatibility.status === "compatible")
      ? "READY TO COMPARE" : "KEEP";

  return <main className="optimizer-canvas">
    <header className="optimizer-header">
      <div><h1>Dependency optimizer</h1><p>Commit <code>{selected.commit.slice(0, 7)}</code> · analyzed {date(selected.completedAt)}</p></div>
      <div className={`optimizer-verdict is-${status.toLowerCase().replaceAll(" ", "-")}`}><AlertCircle size={20} /><strong>{status}</strong><span>{selected.ownerUsage ? "Compatibility gates evaluated before economics." : "Resolve operational inputs before comparing providers."}</span></div>
    </header>
    <div className="optimizer-layout">
      <aside className="optimizer-history"><h2>Analysis history</h2>{analyses.map((analysis) => <button className={analysis.id === selected.id ? "is-selected" : ""} key={analysis.id} onClick={() => selectAnalysis(analysis)} type="button"><time>{date(analysis.createdAt)}</time><strong>{analysis.status === "failed" ? "ERROR" : analysis.ownerUsage ? "COMPLETE" : "INVESTIGATE"}</strong></button>)}</aside>
      <section className="optimizer-workspace">
        <div className="optimizer-observation"><span>Detected service <strong>{label(observation.serviceId)}</strong></span><span>Provenance <strong>{observation.evidence[0]?.provenance ? label(observation.evidence[0].provenance) : "Observed"}</strong></span><span>Confidence <strong>{label(observation.confidence)}</strong></span></div>
        <div className="optimizer-table capability-table"><div className="optimizer-row optimizer-columns"><span>Capability</span><span>Requirement</span><span>Confidence</span><span>Evidence</span></div>{selected.capabilities.map((capability) => <details className="optimizer-row" key={capability.capabilityId}><summary><span>{label(capability.capabilityId)}</span><span className={capability.requirement === "required" ? "is-danger" : "is-warning"}>{label(capability.requirement)}</span><span className="is-accent">{label(capability.confidence)}</span><span>{capability.evidence[0]?.file ?? "Owner confirmed"}<ChevronDown size={13} /></span></summary><div className="optimizer-evidence"><FileCode2 size={14} /><strong>{capability.evidence[0]?.reason ?? "Owner-confirmed capability."}</strong><code>{capability.evidence[0]?.file}:{capability.evidence[0]?.lineStart ?? ""}</code></div></details>)}</div>
        <h2 className="optimizer-section-title">Provider comparison for transactional email</h2>
        {!selected.ownerUsage ? <div className="optimizer-blocker"><AlertTriangle size={17} /><span>Monthly volume, region, and operational requirements are required before cost comparison.</span></div> : <div className="optimizer-table provider-table"><div className="optimizer-row optimizer-columns"><span>Provider</span><span>Monthly cost range</span><span>Compatibility gates</span><span>Migration effort</span><span>Operational burden</span><span>Payback</span><span>Versions</span></div>{comparison.map((item) => <details className="optimizer-row" key={item.serviceId}><summary><strong>{item.serviceId === "ses" ? "Amazon SES" : "Postmark"}</strong><span>{costRange(item.price.snapshot?.monthlyCost)}</span><span className={item.compatibility.status === "incompatible" ? "is-danger" : item.compatibility.unknowns.length ? "is-warning" : "is-accent"}>{item.compatibility.unknowns.length ? "Review inputs" : label(item.compatibility.status)}</span><span>{item.effort.engineeringHours.likely} hours</span><span className={item.operations.level === "high" ? "is-danger" : "is-warning"}>{label(item.operations.level)}</span><span className="is-warning">Policy required</span><span><code>{item.compatibility.catalogVersion}</code><code>{item.price.snapshot?.pricingVersion ?? "pricing incomplete"}</code>{item.price.snapshot?.stale ? <em className="is-warning">STALE</em> : null}</span></summary><div className="provider-detail"><div><h3>Gate differences</h3>{item.compatibility.semanticDifferences.length ? item.compatibility.semanticDifferences.map((difference) => <p key={difference}>{difference}</p>) : <p>No blocking semantic differences.</p>}</div><div><h3>Reasoning</h3>{item.operations.reasons.map((reason) => <p key={reason}>{reason}</p>)}<p>Payback remains unavailable until recommendation policy inputs are confirmed.</p></div></div></details>)}</div>}
        <section className="optimizer-gaps"><h2>Unknowns and gaps</h2>{unresolved.length ? unresolved.map((item) => <p key={item}><CircleSlash2 size={13} />{item}</p>) : <p><Check size={13} />No analyzer gaps recorded.</p>}<p><Clock3 size={13} />Catalog email-2026-08-24 · Pricing email-pricing-2026-08-25</p></section>
      </section>
      <aside className="optimizer-inspector"><section><h2>Owner inputs</h2><label>Monthly email volume<input inputMode="numeric" value={volume} onChange={(event) => setVolume(event.target.value)} /></label><label>AWS region<input placeholder="us-east-1" value={region} onChange={(event) => setRegion(event.target.value)} /></label><label className="optimizer-check"><input checked={dedicatedIp} onChange={(event) => setDedicatedIp(event.target.checked)} type="checkbox" />Dedicated IP required</label><label>Critical operational requirements<textarea rows={4} value={requirements} onChange={(event) => setRequirements(event.target.value)} /></label><button className="optimizer-button is-primary" disabled={busy || !volume} onClick={saveUsage} type="button"><Save size={14} />Save confirmed inputs</button></section><details open><summary>Observation correction<ChevronDown size={14} /></summary><label>Correct capability IDs<input value={correctionCapabilities} onChange={(event) => setCorrectionCapabilities(event.target.value)} /></label><label>Reason<textarea rows={3} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label><button className="optimizer-button" disabled={busy || correctionReason.trim().length < 3} onClick={reportCorrection} type="button">Report correction</button></details>{message ? <p className="optimizer-message" role="status">{message}</p> : null}</aside>
    </div>
  </main>;
}

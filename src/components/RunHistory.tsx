import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { HostedRunRecord } from "../control-plane/types";

const demoRuns: HostedRunRecord[] = [
  {
    id: "RUN-DEMO-001",
    incidentId: "INC-SENTRY-428",
    repository: "acme/storefront",
    commit: "4f8c21a",
    status: "awaiting_approval",
    decision: "review_required",
    repairId: "REPAIR-DEMO-001",
    createdAt: "2026-07-30T06:12:00Z",
    updatedAt: "2026-07-30T06:18:00Z",
  },
];

function statusIcon(status: HostedRunRecord["status"]) {
  if (status === "blocked") return ShieldAlert;
  if (status === "completed") return CheckCircle2;
  return CircleDot;
}

export function RunHistory() {
  const [runs, setRuns] = useState<HostedRunRecord[]>(demoRuns);
  const [selectedId, setSelectedId] = useState(demoRuns[0].id);
  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/runs")
      .then(async (response) => {
        if (!response.ok) throw new Error("API unavailable");
        return (await response.json()) as { runs: HostedRunRecord[] };
      })
      .then(({ runs: nextRuns }) => {
        if (nextRuns.length) {
          setRuns(nextRuns);
          setSelectedId(nextRuns[0].id);
        }
      })
      .catch(() => undefined);
  }, []);

  const selected = runs.find(({ id }) => id === selectedId) ?? runs[0];

  async function decide(decision: "approved" | "rejected") {
    if (!selected || !actor.trim() || !reason.trim() || !token.trim()) {
      setMessage("Identity, reason, and approval token are required.");
      return;
    }
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(selected.id)}/decision`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ decision, actor, reason }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Decision failed.");
      }
      const payload = (await response.json()) as { run: HostedRunRecord };
      setRuns((current) =>
        current.map((run) => (run.id === payload.run.id ? payload.run : run)),
      );
      setMessage(decision === "approved" ? "Repair approved." : "Repair rejected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision failed.");
    }
  }

  return (
    <main className="runs-canvas">
      <header className="runs-header">
        <div>
          <h1>Repair runs</h1>
          <p>Production incidents, deterministic evidence, and human decisions.</p>
        </div>
        <span className="live-indicator">Control plane</span>
      </header>

      <div className="runs-layout">
        <section className="run-list" aria-label="Repair run history">
          {runs.map((run) => {
            const Icon = statusIcon(run.status);
            return (
              <button
                className={`run-row ${run.id === selected?.id ? "is-selected" : ""}`}
                key={run.id}
                onClick={() => setSelectedId(run.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={17} />
                <span>
                  <strong>{run.repository}</strong>
                  <small>{run.id}</small>
                </span>
                <em>{run.status.replaceAll("_", " ")}</em>
              </button>
            );
          })}
        </section>

        {selected ? (
          <section className="run-detail">
            <div className="run-detail-heading">
              <div>
                <span>{selected.incidentId}</span>
                <h2>{selected.repository}</h2>
              </div>
              <strong>{selected.decision ?? "pending"}</strong>
            </div>
            <dl>
              <div>
                <dt>Commit</dt>
                <dd>{selected.commit ?? "Awaiting release mapping"}</dd>
              </div>
              <div>
                <dt>Repair</dt>
                <dd>{selected.repairId ?? "Not generated"}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(selected.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
            {selected.pullRequestUrl ? (
              <a href={selected.pullRequestUrl} rel="noreferrer" target="_blank">
                Open draft pull request <ExternalLink size={14} />
              </a>
            ) : null}
            {selected.status === "awaiting_approval" ? (
            <div className="decision-form">
              <h3>Recorded human decision</h3>
              <input
                aria-label="Reviewer identity"
                onChange={(event) => setActor(event.target.value)}
                placeholder="Reviewer identity"
                value={actor}
              />
              <textarea
                aria-label="Decision reason"
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this repair safe or unsafe?"
                value={reason}
              />
              <input
                aria-label="Approval token"
                onChange={(event) => setToken(event.target.value)}
                placeholder="Approval token"
                type="password"
                value={token}
              />
              <div>
                <button onClick={() => void decide("rejected")} type="button">
                  Reject
                </button>
                <button
                  className="primary-decision"
                  onClick={() => void decide("approved")}
                  type="button"
                >
                  Approve
                </button>
              </div>
              {message ? <p role="status">{message}</p> : null}
            </div>
            ) : (
              <p className="decision-recorded">
                This run is {selected.status.replaceAll("_", " ")}. Its decision
                record is closed.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

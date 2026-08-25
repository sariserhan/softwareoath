import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiClient } from "../api/client.js";
import type {
  HostedRunRecord,
  ReviewerIdentity,
  RunLogRecord,
} from "../control-plane/types.js";

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(
        error instanceof Error ? error.message : "Request failed.",
        0,
        "unavailable",
        "unknown",
        true,
      );
}

function statusIcon(status: HostedRunRecord["status"]) {
  if (status === "blocked") return ShieldAlert;
  if (status === "completed") return CheckCircle2;
  return CircleDot;
}

export function RunHistory() {
  const [runs, setRuns] = useState<HostedRunRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<ApiError>();
  const [retryKey, setRetryKey] = useState(0);
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<RunLogRecord[]>([]);
  const [reviewer, setReviewer] = useState<ReviewerIdentity>();
  const [csrfToken, setCsrfToken] = useState("");
  const [sessionError, setSessionError] = useState<ApiError>();
  const [logsError, setLogsError] = useState<ApiError>();

  useEffect(() => {
    let active = true;
    async function refresh() {
      setRefreshing(true);
      try {
        const { runs: nextRuns } = await apiClient.get<{
          runs: HostedRunRecord[];
        }>("/api/runs");
        if (active) {
          setRuns(nextRuns);
          setLoadError(undefined);
          setSelectedId((current) =>
            nextRuns.some(({ id }) => id === current)
              ? current
              : (nextRuns[0]?.id ?? ""),
          );
        }
      } catch (error) {
        if (active) setLoadError(asApiError(error));
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [retryKey]);

  useEffect(() => {
    void apiClient
      .get<{
        authenticated: boolean;
        identity?: ReviewerIdentity;
        csrfToken?: string;
      }>("/api/auth/session")
      .then((session) => {
        setReviewer(session.identity);
        setCsrfToken(session.csrfToken ?? "");
        setSessionError(undefined);
      })
      .catch((error) => setSessionError(asApiError(error)));
  }, [retryKey]);

  const selected = runs.find(({ id }) => id === selectedId) ?? runs[0];

  useEffect(() => {
    if (!selected?.id) return;
    let active = true;
    void apiClient
      .get<{ logs: RunLogRecord[] }>(
        "/api/runs/" + encodeURIComponent(selected.id) + "/logs",
      )
      .then(({ logs }) => {
        if (active) {
          setLogs(logs);
          setLogsError(undefined);
        }
      })
      .catch((error) => {
        if (active) {
          setLogs([]);
          setLogsError(asApiError(error));
        }
      });
    return () => {
      active = false;
    };
  }, [selected?.id, selected?.updatedAt]);

  async function decide(decision: "approved" | "rejected") {
    if (!selected || !reviewer || !reason.trim() || !csrfToken) {
      setMessage("Sign in with GitHub and provide a written reason.");
      return;
    }
    try {
      const payload = await apiClient.post<{ run: HostedRunRecord }>(
        "/api/runs/" + encodeURIComponent(selected.id) + "/decision",
        { decision, reason },
        csrfToken,
      );
      setRuns((current) =>
        current.map((run) => (run.id === payload.run.id ? payload.run : run)),
      );
      setMessage(
        decision === "approved" ? "Repair approved." : "Repair rejected.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision failed.");
    }
  }

  async function cancel() {
    if (!selected || !token.trim()) {
      setMessage("Operator token is required.");
      return;
    }
    try {
      const payload = await apiClient.request<{ run: HostedRunRecord }>(
        "/api/runs/" + encodeURIComponent(selected.id) + "/cancel",
        { method: "POST", headers: { Authorization: "Bearer " + token } },
      );
      setRuns((current) =>
        current.map((run) => (run.id === payload.run.id ? payload.run : run)),
      );
      setMessage("Cancellation requested.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Cancellation failed.",
      );
    }
  }

  return (
    <main className="runs-canvas">
      <header className="runs-header">
        <div>
          <h1>Repair runs</h1>
          <p>
            Production incidents, deterministic evidence, and human decisions.
          </p>
        </div>
        <span className="live-indicator">Control plane</span>
      </header>

      {loading ? <p role="status">Loading repair runs…</p> : null}
      {refreshing && !loading ? (
        <p role="status">Refreshing repair runs…</p>
      ) : null}
      {loadError ? (
        <section
          className="analytics-chart-card"
          data-testid="runs-load-error"
          role="alert"
        >
          <h2>
            {runs.length ? "Run data may be stale" : "Repair runs unavailable"}
          </h2>
          <p>{loadError.message}</p>
          <p>Correlation ID: {loadError.correlationId}</p>
          <button onClick={() => setRetryKey((key) => key + 1)} type="button">
            Retry runs
          </button>
        </section>
      ) : null}
      {sessionError ? (
        <section
          className="analytics-chart-card"
          data-testid="runs-session-error"
          role="alert"
        >
          <h2>
            {sessionError.kind === "permission_denied"
              ? "Review permission denied"
              : "Reviewer session unavailable"}
          </h2>
          <p>{sessionError.message}</p>
          {sessionError.kind === "unauthenticated" ? (
            <a href="/api/auth/github">Sign in with GitHub</a>
          ) : null}
        </section>
      ) : null}
      {!loading && !loadError && runs.length === 0 ? (
        <section className="analytics-chart-card" data-testid="runs-empty">
          <h2>No repair runs yet</h2>
          <p>Connect a repository and start a scan to create the first run.</p>
        </section>
      ) : null}

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
              <a
                href={selected.pullRequestUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open draft pull request <ExternalLink size={14} />
              </a>
            ) : null}
            <div className="run-operations">
              <input
                aria-label="Operator token"
                onChange={(event) => setToken(event.target.value)}
                placeholder="Operator token"
                type="password"
                value={token}
              />
              {!["completed", "blocked", "cancelled"].includes(
                selected.status,
              ) ? (
                <button onClick={() => void cancel()} type="button">
                  Cancel run
                </button>
              ) : null}
            </div>
            <section className="run-log" aria-label="Run logs">
              <h3>Live execution log</h3>
              {logsError ? (
                <p role="alert">Logs unavailable: {logsError.message}</p>
              ) : null}
              {logs.length ? (
                <ol>
                  {logs.map((log) => (
                    <li className={`is-${log.level}`} key={log.id}>
                      <time>
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </time>
                      <span>{log.message}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No execution events recorded yet.</p>
              )}
            </section>
            {selected.status === "awaiting_approval" ? (
              <div className="decision-form">
                <h3>Recorded human decision</h3>
                {reviewer ? (
                  <p>
                    Signed in as <strong>@{reviewer.login}</strong>. GitHub
                    write permission for this repository will be checked when
                    you decide.
                  </p>
                ) : (
                  <a href="/api/auth/github">Sign in with GitHub to review</a>
                )}
                <textarea
                  aria-label="Decision reason"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this repair safe or unsafe?"
                  value={reason}
                />
                <div>
                  <button onClick={() => void decide("rejected")} type="button">
                    Reject
                  </button>
                  <button
                    className="primary-decision"
                    disabled={!reviewer}
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

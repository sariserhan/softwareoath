import { CircleCheck, GitBranch, LoaderCircle, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { parseOath } from "../domain/oath";

interface SessionPayload {
  authenticated: boolean;
  csrfToken?: string;
  identity?: { login: string; displayName?: string };
}

interface AvailableRepository {
  repository: string;
  cloneUrl: string;
  defaultBranch: string;
  installationId: number;
  private: boolean;
}

interface AvailableOrganization {
  login: string;
  avatarUrl?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "signed_out" }
  | {
      status: "ready";
      session: SessionPayload;
      organizations: AvailableOrganization[];
      repositories: AvailableRepository[];
    }
  | { status: "error"; message: string };

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}.`);
  }
  return payload;
}

interface HostedRunProgress {
  id: string;
  repository: string;
  status: string;
  decision?: string;
  error?: string;
  pullRequestUrl?: string;
}

const terminalRunStatuses = new Set([
  "completed", "blocked", "cancelled", "ci_failed", "awaiting_approval",
]);

const runStatusLabels: Record<string, string> = {
  received: "Queued",
  reproducing: "Inspecting immutable commit",
  repairing: "Preparing bounded repair",
  verifying: "Verifying evidence",
  ci_pending: "Waiting for GitHub checks",
  awaiting_approval: "Ready for owner review",
  completed: "Scan complete",
  blocked: "Blocked safely",
  retry_wait: "Waiting to retry",
  cancelled: "Cancelled",
  ci_failed: "GitHub checks failed",
};

interface InitialOathDraft {
  source: string;
  warnings: string[];
  generatedAt: string;
}

function OathDraftEditor({
  draft,
  onPropose,
  proposalUrl,
  submitting,
}: {
  draft: InitialOathDraft;
  onPropose: (source: string) => void;
  proposalUrl?: string;
  submitting: boolean;
}) {
  const [source, setSource] = useState(draft.source);
  const validation = useMemo(() => {
    try {
      return { status: "valid" as const, oath: parseOath(source) };
    } catch (error) {
      return {
        status: "invalid" as const,
        error: error instanceof Error ? error.message : "Oath YAML is invalid.",
      };
    }
  }, [source]);

  return (
    <section className="analytics-chart-card" data-testid="oath-draft-editor">
      <div className="analytics-chart-header">
        <h3>Initial oath draft</h3>
        <span className="analytics-chart-badge">Owner review required</span>
      </div>
      <p>
        Generated from repository-owned manifests and workflows. Editing this
        preview does not change the repository.
      </p>
      {draft.warnings.length > 0 ? (
        <ul>
          {draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      <label>
        <span className="form-label">software-oath.yml</span>
        <textarea
          aria-label="Initial oath YAML"
          onChange={(event) => setSource(event.target.value)}
          rows={22}
          spellCheck={false}
          value={source}
        />
      </label>
      {validation.status === "invalid" ? (
        <p role="alert">Schema error: {validation.error}</p>
      ) : (
        <div aria-label="Oath summary">
          <p role="status">Schema valid</p>
          <dl className="repository-facts">
            <div><dt>Application</dt><dd>{validation.oath.application.name}</dd></div>
            <div><dt>Repository</dt><dd>{validation.oath.application.repository}</dd></div>
            <div><dt>Default branch</dt><dd>{validation.oath.application.defaultBranch}</dd></div>
            <div><dt>Rules</dt><dd>{validation.oath.rules.length}</dd></div>
          </dl>
          <ul>
            {validation.oath.rules.map((rule) => (
              <li key={rule.id}>
                <strong>{rule.title}</strong> · {rule.severity} · {rule.evidence.length} evidence requirement(s)
              </li>
            ))}
          </ul>
          <button
            disabled={submitting}
            onClick={() => onPropose(source)}
            type="button"
          >
            {submitting ? "Proposing…" : "Propose oath as draft PR"}
          </button>
          {proposalUrl ? (
            <p><a href={proposalUrl}>Review draft oath pull request</a></p>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function ConnectRepository() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState("");
  const [schedule, setSchedule] = useState("weekly");
  const [allowMajor, setAllowMajor] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState<string>();
  const [draft, setDraft] = useState<InitialOathDraft>();
  const [proposalUrl, setProposalUrl] = useState<string>();
  const [scanRun, setScanRun] = useState<HostedRunProgress>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const session = await responseJson<SessionPayload>(
          await fetch("/api/auth/session", { credentials: "same-origin" }),
        );
        if (!active) return;
        if (!session.authenticated) {
          setLoadState({ status: "signed_out" });
          return;
        }
        const repositories = await responseJson<{
          organizations: AvailableOrganization[];
          repositories: AvailableRepository[];
        }>(
          await fetch("/api/github/repositories", {
            credentials: "same-origin",
          }),
        );
        if (!active) return;
        setLoadState({
          status: "ready",
          session,
          organizations: repositories.organizations,
          repositories: repositories.repositories,
        });
        setSelected(repositories.repositories[0]?.repository ?? "");
      } catch (error) {
        if (active) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : "Onboarding failed.",
          });
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const scanRunId = scanRun?.id;
  const scanRunStatus = scanRun?.status;
  useEffect(() => {
    if (
      !registered ||
      !scanRunId ||
      !scanRunStatus ||
      terminalRunStatuses.has(scanRunStatus)
    ) return;
    const progressRepository = registered;
    const progressRunId = scanRunId;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const payload = await responseJson<{ run: HostedRunProgress }>(
          await fetch(
            "/api/repositories/" + encodeURIComponent(progressRepository) +
              "/runs/" + encodeURIComponent(progressRunId),
            { credentials: "same-origin" },
          ),
        );
        if (!active) return;
        setScanRun(payload.run);
        if (!terminalRunStatuses.has(payload.run.status)) {
          timeout = setTimeout(() => void poll(), 1500);
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Scan progress failed.");
        }
      }
    }
    timeout = setTimeout(() => void poll(), 500);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [registered, scanRunId, scanRunStatus]);

  if (loadState.status === "loading") {
    return (
      <main className="analytics-dashboard" data-testid="connect-loading">
        <div className="analytics-chart-card">
          <LoaderCircle aria-hidden="true" className="spin" size={20} />
          <p>Loading GitHub connection…</p>
        </div>
      </main>
    );
  }

  if (loadState.status === "signed_out") {
    return (
      <main className="analytics-dashboard" data-testid="connect-signed-out">
        <header className="analytics-header">
          <h2>Connect a repository</h2>
          <span className="analytics-subtitle">
            Sign in as a repository owner to begin stewardship.
          </span>
        </header>
        <section className="analytics-chart-card">
          <h3><GitBranch size={18} /> GitHub owner authentication</h3>
          <p>
            Software Oath checks your live repository permission before
            registration, scans, and repair decisions.
          </p>
          <a className="primary-action" href="/api/auth/github">
            Sign in with GitHub
          </a>
        </section>
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="analytics-dashboard" data-testid="connect-error">
        <header className="analytics-header"><h2>Connection unavailable</h2></header>
        <section className="analytics-chart-card">
          <p>{loadState.message}</p>
        </section>
      </main>
    );
  }

  const readyState = loadState;
  const repository = readyState.repositories.find(
    (candidate) => candidate.repository === selected,
  );
  const scanActive = Boolean(
    scanRun && !terminalRunStatuses.has(scanRun.status),
  );

  async function register() {
    if (!repository || !readyState.session.csrfToken) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      await responseJson(
        await fetch("/api/repositories", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": readyState.session.csrfToken,
          },
          body: JSON.stringify({
            repository: repository.repository,
            cloneUrl: repository.cloneUrl,
            defaultBranch: repository.defaultBranch,
            installationId: repository.installationId,
            schedule: { mode: schedule, timezone: "UTC" },
            policy: {
              maxPullRequestsPerRun: 1,
              maxCiRepairAttempts: 2,
              allowMajorPackageUpdates: allowMajor,
            },
          }),
        }),
      );
      setRegistered(repository.repository);
      setDraft(undefined);
      setProposalUrl(undefined);
      setScanRun(undefined);
      setMessage("Repository registered. Start the first read-only scan.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function startScan() {
    if (!registered || !readyState.session.csrfToken) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const payload = await responseJson<{ run: HostedRunProgress }>(
        await fetch(
          `/api/repositories/${encodeURIComponent(registered)}/scan`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": readyState.session.csrfToken },
          },
        ),
      );
      setScanRun(payload.run);
      setMessage("First scan queued. Live progress is shown below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadDraft() {
    if (!registered) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const payload = await responseJson<{ draft: InitialOathDraft }>(
        await fetch(
          "/api/repositories/" + encodeURIComponent(registered) + "/oath-draft",
          { credentials: "same-origin" },
        ),
      );
      setDraft(payload.draft);
      setMessage("Initial oath draft loaded for owner review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Oath draft failed to load.");
    } finally {
      setSubmitting(false);
    }
  }

  async function proposeOath(source: string) {
    if (!registered || !readyState.session.csrfToken) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const payload = await responseJson<{ proposal: { html_url: string } }>(
        await fetch(
          "/api/repositories/" + encodeURIComponent(registered) + "/oath-proposal",
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": readyState.session.csrfToken,
            },
            body: JSON.stringify({ source }),
          },
        ),
      );
      setProposalUrl(payload.proposal.html_url);
      setMessage("Initial oath proposed as a draft pull request.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Oath proposal failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="analytics-dashboard" data-testid="connect-repository">
      <header className="analytics-header">
        <h2>Connect a repository</h2>
        <span className="analytics-subtitle">
          Signed in as {readyState.session.identity?.login}
        </span>
      </header>

      <section className="analytics-chart-card">
        <div className="analytics-chart-header">
          <h3><GitBranch size={18} /> Eligible GitHub repositories</h3>
          <span className="analytics-chart-badge">
            Owner write access + App installed
          </span>
        </div>

        {readyState.organizations.length > 0 ? (
          <div aria-label="Accessible organizations" className="repository-organizations">
            <span className="form-label">Accessible organizations</span>
            <p>{readyState.organizations.map(({ login }) => login).join(", ")}</p>
          </div>
        ) : null}

        {readyState.repositories.length === 0 ? (
          <div>
            <p>
              No eligible repository was found. Install the Software Oath
              GitHub App on a repository where you have write permission.
            </p>
            <a href="/api/github/install">
              Install Software Oath on GitHub
            </a>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void register();
            }}
            style={{ display: "grid", gap: 18, maxWidth: 720 }}
          >
            <label>
              <span className="form-label">Repository</span>
              <select
                aria-label="Repository"
                onChange={(event) => setSelected(event.target.value)}
                value={selected}
              >
                {readyState.repositories.map((candidate) => (
                  <option
                    key={candidate.repository}
                    value={candidate.repository}
                  >
                    {candidate.repository}
                    {candidate.private ? " · private" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="form-label">Stewardship schedule</span>
              <select
                aria-label="Stewardship schedule"
                onChange={(event) => setSchedule(event.target.value)}
                value={schedule}
              >
                <option value="disabled">Manual only</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>

            <label className="checkbox-row">
              <input
                checked={allowMajor}
                onChange={(event) => setAllowMajor(event.target.checked)}
                type="checkbox"
              />
              Allow major dependency updates as repair candidates
            </label>

            <button disabled={submitting || !repository} type="submit">
              {submitting ? "Registering…" : "Register repository"}
            </button>
          </form>
        )}
      </section>

      {registered ? (
        <section className="analytics-chart-card">
          <h3><CircleCheck size={18} /> Repository registered</h3>
          <p>{registered}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button disabled={submitting || scanActive} onClick={() => void startScan()} type="button">
              <ScanSearch size={16} />
              {submitting ? "Working…" : "Start first scan"}
            </button>
            <button disabled={submitting} onClick={() => void loadDraft()} type="button">
              Review generated oath
            </button>
          </div>
        </section>
      ) : null}

      {scanRun ? (
        <section aria-live="polite" className="analytics-chart-card" data-testid="scan-progress">
          <div className="analytics-chart-header">
            <h3>First scan progress</h3>
            <span className="analytics-chart-badge">
              {runStatusLabels[scanRun.status] ?? scanRun.status}
            </span>
          </div>
          <p>Run {scanRun.id}</p>
          <p>{runStatusLabels[scanRun.status] ?? scanRun.status}</p>
          {scanRun.decision ? <p>Decision: {scanRun.decision}</p> : null}
          {scanRun.error ? <p role="alert">{scanRun.error}</p> : null}
          {scanRun.pullRequestUrl ? (
            <a href={scanRun.pullRequestUrl}>Review scan pull request</a>
          ) : null}
          {scanRun.status === "completed" && scanRun.decision === "review_required" ? (
            <p>The initial oath draft is ready for owner review.</p>
          ) : null}
        </section>
      ) : null}

      {draft ? (
        <OathDraftEditor
          draft={draft}
          onPropose={(source) => void proposeOath(source)}
          proposalUrl={proposalUrl}
          submitting={submitting}
        />
      ) : null}

      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}

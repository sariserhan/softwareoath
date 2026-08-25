import { CircleCheck, GitBranch, LoaderCircle, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiError, apiClient } from "../api/client.js";
import { parseOath } from "../domain/oath.js";

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
  | { status: "error"; issue: OnboardingIssue };

type OnboardingIssueKind =
  | "session_expired"
  | "revoked_installation"
  | "permission_denied"
  | "missing_oath"
  | "unsupported_repository"
  | "failed_scan"
  | "disconnected"
  | "unknown";

interface OnboardingIssue {
  kind: OnboardingIssueKind;
  title: string;
  message: string;
}

function issueFromError(error: unknown): OnboardingIssue {
  const message = error instanceof Error ? error.message : "Onboarding failed.";
  const lower = message.toLowerCase();
  if (error instanceof ApiError && error.status === 401) {
    return {
      kind: "session_expired",
      title: "GitHub session expired",
      message,
    };
  }
  if (lower.includes("installation") || lower.includes("github app")) {
    return {
      kind: "revoked_installation",
      title: "GitHub App disconnected",
      message,
    };
  }
  if (error instanceof ApiError && error.status === 403) {
    return {
      kind: "permission_denied",
      title: "Repository permission denied",
      message,
    };
  }
  if (
    error instanceof ApiError &&
    error.status === 404 &&
    lower.includes("oath")
  ) {
    return {
      kind: "missing_oath",
      title: "Initial oath is not ready",
      message,
    };
  }
  if (lower.includes("unsupported") || lower.includes("coverage gap")) {
    return {
      kind: "unsupported_repository",
      title: "Repository needs configuration",
      message,
    };
  }
  if (
    error instanceof TypeError ||
    (error instanceof ApiError && error.kind === "unavailable")
  ) {
    return {
      kind: "disconnected",
      title: "Software Oath is disconnected",
      message,
    };
  }
  return { kind: "unknown", title: "Onboarding could not continue", message };
}

function issueFromRun(
  run: HostedRunProgress | undefined,
): OnboardingIssue | undefined {
  if (!run || !["blocked", "ci_failed"].includes(run.status)) return undefined;
  const error =
    run.error ?? runStatusLabels[run.status] ?? "The scan stopped safely.";
  if (
    error.toLowerCase().includes("unsupported") ||
    error.toLowerCase().includes("coverage gap")
  ) {
    return {
      kind: "unsupported_repository",
      title: "Repository needs configuration",
      message: error,
    };
  }
  return {
    kind: "failed_scan",
    title: "First scan failed safely",
    message: error,
  };
}

function OnboardingRecovery({
  issue,
  onRetry,
}: {
  issue: OnboardingIssue;
  onRetry?: () => void;
}) {
  return (
    <section
      className="analytics-chart-card"
      data-testid={"onboarding-issue-" + issue.kind}
      role="alert"
    >
      <h3>{issue.title}</h3>
      <p>{issue.message}</p>
      {issue.kind === "session_expired" ? (
        <a href="/api/auth/github">Sign in again</a>
      ) : null}
      {issue.kind === "revoked_installation" ? (
        <a href="/api/github/install">Reconnect GitHub App</a>
      ) : null}
      {issue.kind === "permission_denied" ? (
        <p>Choose another repository or ask an owner to grant write access.</p>
      ) : null}
      {issue.kind === "missing_oath" ? (
        <p>
          Start the first scan, then retry once the generated oath is ready.
        </p>
      ) : null}
      {issue.kind === "unsupported_repository" ? (
        <p>
          Review the generated oath and add a supported validation command or
          workflow.
        </p>
      ) : null}
      {issue.kind === "failed_scan" ? (
        <p>
          Review the scan error, update the repository if needed, and retry
          safely.
        </p>
      ) : null}
      {onRetry ? (
        <button onClick={onRetry} type="button">
          Retry connection
        </button>
      ) : null}
    </section>
  );
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
  "completed",
  "blocked",
  "cancelled",
  "ci_failed",
  "awaiting_approval",
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
          {draft.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
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
            <div>
              <dt>Application</dt>
              <dd>{validation.oath.application.name}</dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd>{validation.oath.application.repository}</dd>
            </div>
            <div>
              <dt>Default branch</dt>
              <dd>{validation.oath.application.defaultBranch}</dd>
            </div>
            <div>
              <dt>Rules</dt>
              <dd>{validation.oath.rules.length}</dd>
            </div>
          </dl>
          <ul>
            {validation.oath.rules.map((rule) => (
              <li key={rule.id}>
                <strong>{rule.title}</strong> · {rule.severity} ·{" "}
                {rule.evidence.length} evidence requirement(s)
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
            <p>
              <a href={proposalUrl}>Review draft oath pull request</a>
            </p>
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
  const [issue, setIssue] = useState<OnboardingIssue>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const session =
          await apiClient.get<SessionPayload>("/api/auth/session");
        if (!active) return;
        if (!session.authenticated) {
          setLoadState({ status: "signed_out" });
          return;
        }
        const repositories = await apiClient.get<{
          organizations: AvailableOrganization[];
          repositories: AvailableRepository[];
        }>("/api/github/repositories");
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
            issue: issueFromError(error),
          });
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const scanRunId = scanRun?.id;
  const scanRunStatus = scanRun?.status;
  useEffect(() => {
    if (
      !registered ||
      !scanRunId ||
      !scanRunStatus ||
      terminalRunStatuses.has(scanRunStatus)
    )
      return;
    const progressRepository = registered;
    const progressRunId = scanRunId;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const payload = await apiClient.get<{ run: HostedRunProgress }>(
          "/api/repositories/" +
            encodeURIComponent(progressRepository) +
            "/runs/" +
            encodeURIComponent(progressRunId),
        );
        if (!active) return;
        setScanRun(payload.run);
        if (!terminalRunStatuses.has(payload.run.status)) {
          timeout = setTimeout(() => void poll(), 1500);
        }
      } catch (error) {
        if (active) {
          setIssue(issueFromError(error));
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
          <h3>
            <GitBranch size={18} /> GitHub owner authentication
          </h3>
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
        <header className="analytics-header">
          <h2>Connection unavailable</h2>
        </header>
        <OnboardingRecovery
          issue={loadState.issue}
          onRetry={
            loadState.issue.kind === "disconnected"
              ? () => {
                  setLoadState({ status: "loading" });
                  setReloadKey((key) => key + 1);
                }
              : undefined
          }
        />
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
  const runIssue = issueFromRun(scanRun);

  async function register() {
    if (!repository || !readyState.session.csrfToken) return;
    setSubmitting(true);
    setMessage(undefined);
    setIssue(undefined);
    try {
      await apiClient.post(
        "/api/repositories",
        {
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
        },
        readyState.session.csrfToken,
      );
      setRegistered(repository.repository);
      setDraft(undefined);
      setProposalUrl(undefined);
      setScanRun(undefined);
      setMessage("Repository registered. Start the first read-only scan.");
    } catch (error) {
      setIssue(issueFromError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function startScan() {
    if (!registered || !readyState.session.csrfToken) return;
    setSubmitting(true);
    setMessage(undefined);
    setIssue(undefined);
    try {
      const payload = await apiClient.post<{ run: HostedRunProgress }>(
        "/api/repositories/" + encodeURIComponent(registered) + "/scan",
        undefined,
        readyState.session.csrfToken,
      );
      setScanRun(payload.run);
      setMessage("First scan queued. Live progress is shown below.");
    } catch (error) {
      setIssue(issueFromError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadDraft() {
    if (!registered) return;
    setSubmitting(true);
    setMessage(undefined);
    setIssue(undefined);
    try {
      const payload = await apiClient.get<{ draft: InitialOathDraft }>(
        "/api/repositories/" + encodeURIComponent(registered) + "/oath-draft",
      );
      setDraft(payload.draft);
      setMessage("Initial oath draft loaded for owner review.");
    } catch (error) {
      setIssue(issueFromError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function proposeOath(source: string) {
    if (!registered || !readyState.session.csrfToken) return;
    setSubmitting(true);
    setMessage(undefined);
    setIssue(undefined);
    try {
      const payload = await apiClient.post<{ proposal: { html_url: string } }>(
        "/api/repositories/" +
          encodeURIComponent(registered) +
          "/oath-proposal",
        { source },
        readyState.session.csrfToken,
      );
      setProposalUrl(payload.proposal.html_url);
      setMessage("Initial oath proposed as a draft pull request.");
    } catch (error) {
      setIssue(issueFromError(error));
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
          <h3>
            <GitBranch size={18} /> Eligible GitHub repositories
          </h3>
          <span className="analytics-chart-badge">
            Owner write access + App installed
          </span>
        </div>

        {readyState.organizations.length > 0 ? (
          <div
            aria-label="Accessible organizations"
            className="repository-organizations"
          >
            <span className="form-label">Accessible organizations</span>
            <p>
              {readyState.organizations.map(({ login }) => login).join(", ")}
            </p>
          </div>
        ) : null}

        {readyState.repositories.length === 0 ? (
          <div>
            <p>
              No eligible repository was found. Install the Software Oath GitHub
              App on a repository where you have write permission.
            </p>
            <a href="/api/github/install">Install Software Oath on GitHub</a>
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
          <h3>
            <CircleCheck size={18} /> Repository registered
          </h3>
          <p>{registered}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              disabled={submitting || scanActive}
              onClick={() => void startScan()}
              type="button"
            >
              <ScanSearch size={16} />
              {submitting ? "Working…" : "Start first scan"}
            </button>
            <button
              disabled={submitting}
              onClick={() => void loadDraft()}
              type="button"
            >
              Review generated oath
            </button>
          </div>
        </section>
      ) : null}

      {scanRun ? (
        <section
          aria-live="polite"
          className="analytics-chart-card"
          data-testid="scan-progress"
        >
          <div className="analytics-chart-header">
            <h3>First scan progress</h3>
            <span className="analytics-chart-badge">
              {runStatusLabels[scanRun.status] ?? scanRun.status}
            </span>
          </div>
          <p>Run {scanRun.id}</p>
          <p>{runStatusLabels[scanRun.status] ?? scanRun.status}</p>
          {scanRun.decision ? <p>Decision: {scanRun.decision}</p> : null}
          {scanRun.pullRequestUrl ? (
            <a href={scanRun.pullRequestUrl}>Review scan pull request</a>
          ) : null}
          {scanRun.status === "completed" &&
          scanRun.decision === "review_required" ? (
            <p>The initial oath draft is ready for owner review.</p>
          ) : null}
        </section>
      ) : null}

      {runIssue ? <OnboardingRecovery issue={runIssue} /> : null}

      {draft ? (
        <OathDraftEditor
          draft={draft}
          onPropose={(source) => void proposeOath(source)}
          proposalUrl={proposalUrl}
          submitting={submitting}
        />
      ) : null}

      {message ? <p role="status">{message}</p> : null}
      {issue ? <OnboardingRecovery issue={issue} /> : null}
    </main>
  );
}

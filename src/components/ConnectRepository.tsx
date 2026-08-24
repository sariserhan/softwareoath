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

interface InitialOathDraft {
  source: string;
  warnings: string[];
  generatedAt: string;
}

function OathDraftEditor({ draft }: { draft: InitialOathDraft }) {
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
      await responseJson(
        await fetch(
          `/api/repositories/${encodeURIComponent(registered)}/scan`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": readyState.session.csrfToken },
          },
        ),
      );
      setMessage("First scan queued. Follow its progress in Runs.");
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
            <button disabled={submitting} onClick={() => void startScan()} type="button">
              <ScanSearch size={16} />
              {submitting ? "Working…" : "Start first scan"}
            </button>
            <button disabled={submitting} onClick={() => void loadDraft()} type="button">
              Review generated oath
            </button>
          </div>
        </section>
      ) : null}

      {draft ? <OathDraftEditor draft={draft} /> : null}

      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}

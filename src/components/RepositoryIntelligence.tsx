import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  Eye,
  FileCode2,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  RepositoryKnowledgeRecord,
  RepositoryQuestionRecord,
  RepositoryRegistration,
  ReviewerIdentity,
} from "../control-plane/types";

type IntelligenceTab = "Knowledge" | "Questions" | "Custom Promises";

const demoRepository: RepositoryRegistration = {
  id: "REPOSITORY-DEMO",
  repository: "acme/storefront",
  cloneUrl: "https://github.com/acme/storefront.git",
  defaultBranch: "main",
  installationId: 1,
  schedule: { mode: "weekly", timezone: "America/New_York" },
  policy: {
    maxPullRequestsPerRun: 1,
    maxCiRepairAttempts: 2,
    allowMajorPackageUpdates: false,
    automaticMerge: false,
  },
  lastRunAt: "2026-07-30T12:00:00Z",
  createdAt: "2026-07-01T12:00:00Z",
  updatedAt: "2026-07-30T12:00:00Z",
};

const demoIdentity = {
  provider: "github" as const,
  providerUserId: "42",
  login: "owner",
};

const demoKnowledge: RepositoryKnowledgeRecord[] = [
  {
    id: "KNOWLEDGE-BUSINESS-1",
    repository: "acme/storefront",
    kind: "owner_confirmed_business_rule",
    statement: "A captured payment must never be charged a second time.",
    scope: { type: "workflow", value: "checkout" },
    source: {
      type: "owner_answer",
      questionId: "QUESTION-DEMO-2",
      evidence: ["Owner-confirmed checkout invariant"],
    },
    confidence: 1,
    relatedPaths: ["src/payments"],
    blocksRepair: true,
    firstObservedAt: "2026-07-28T12:00:00Z",
    lastVerifiedAt: "2026-07-30T12:00:00Z",
    confirmedBy: demoIdentity,
    createdAt: "2026-07-28T12:00:00Z",
    updatedAt: "2026-07-30T12:00:00Z",
  },
  {
    id: "KNOWLEDGE-TECH-1",
    repository: "acme/storefront",
    kind: "observed_technical_fact",
    statement: ". is an npm workspace with active Software Oath support.",
    scope: { type: "workspace", value: "." },
    source: {
      type: "scan",
      runId: "RUN-DEMO-001",
      commit: "a91d8f2",
      evidence: ["Manifest: package.json", "Lockfile: package-lock.json"],
    },
    confidence: 1,
    relatedPaths: ["package.json", "package-lock.json"],
    blocksRepair: false,
    firstObservedAt: "2026-07-20T12:00:00Z",
    lastVerifiedAt: "2026-07-30T12:00:00Z",
    firstObservedCommit: "8ab3321",
    lastVerifiedCommit: "a91d8f2",
    createdAt: "2026-07-20T12:00:00Z",
    updatedAt: "2026-07-30T12:00:00Z",
  },
  {
    id: "KNOWLEDGE-INFERRED-1",
    repository: "acme/storefront",
    kind: "inferred_technical_fact",
    statement: "Checkout appears to be the primary payment orchestration boundary.",
    scope: { type: "component", value: "checkout" },
    source: {
      type: "repository",
      commit: "a91d8f2",
      evidence: ["src/payments/checkout.ts", "tests/checkout-regression.test.ts"],
    },
    confidence: 0.72,
    relatedPaths: ["src/payments/checkout.ts"],
    blocksRepair: false,
    firstObservedAt: "2026-07-30T12:00:00Z",
    lastVerifiedAt: "2026-07-30T12:00:00Z",
    createdAt: "2026-07-30T12:00:00Z",
    updatedAt: "2026-07-30T12:00:00Z",
  },
];

const demoQuestions: RepositoryQuestionRecord[] = [
  {
    id: "QUESTION-DEMO-1",
    repository: "acme/storefront",
    key: "onboarding.business-purpose",
    status: "open",
    question: "What does this product do, and who are its primary users?",
    why: "Code can suggest responsibilities, but it cannot confirm the intended business purpose.",
    evidence: ["642 tracked files", "npm workspace", "checkout and catalog areas"],
    affects: ["business-scope inference", "repair explanations", "risk priority"],
    suggestedAnswers: [
      "Describe the product in two or three sentences.",
      "Name the primary users and the value they receive.",
    ],
    authorizedRole: "repository_write",
    blocking: "affected_repair",
    answerKnowledgeKind: "owner_confirmed_business_fact",
    createdAt: "2026-07-30T12:00:00Z",
    updatedAt: "2026-07-30T12:00:00Z",
  },
  {
    id: "QUESTION-DEMO-2",
    repository: "acme/storefront",
    key: "onboarding.critical-journeys",
    status: "open",
    question: "Which user journeys and business rules must never be broken?",
    why: "Only an owner can confirm which current behaviors are protected invariants.",
    evidence: ["Payment and order workflows detected", "Human review rule present"],
    affects: ["payment repairs", "order-state changes", "oath proposals"],
    suggestedAnswers: [
      "List critical user journeys.",
      "Include invariants involving money, permissions, or customer data.",
    ],
    authorizedRole: "repository_write",
    blocking: "affected_repair",
    answerKnowledgeKind: "owner_confirmed_business_rule",
    createdAt: "2026-07-30T12:00:00Z",
    updatedAt: "2026-07-30T12:00:00Z",
  },
  {
    id: "QUESTION-DEMO-3",
    repository: "acme/storefront",
    key: "onboarding.protected-operations",
    status: "open",
    question: "Which operations must always require human review?",
    why: "Protected operations require explicit owner authority rather than inference.",
    evidence: ["Authentication and payment paths detected"],
    affects: ["repair authorization", "protected paths"],
    suggestedAnswers: ["Name paths or operations that always require review."],
    authorizedRole: "repository_write",
    blocking: "affected_repair",
    answerKnowledgeKind: "owner_confirmed_business_rule",
    createdAt: "2026-07-30T12:00:00Z",
    updatedAt: "2026-07-30T12:00:00Z",
  },
];

function groupLabel(kind: RepositoryKnowledgeRecord["kind"]): string {
  if (kind.startsWith("owner_confirmed")) return "Owner-confirmed knowledge";
  if (kind === "inferred_technical_fact") return "Inferred knowledge";
  if (kind === "repository_enforced_rule") return "Repository-enforced rules";
  if (kind === "accepted_risk") return "Accepted risks";
  return "Observed technical facts";
}

function confidenceLabel(knowledge: RepositoryKnowledgeRecord): string {
  if (knowledge.confirmedBy) return "Confirmed";
  return `${Math.round(knowledge.confidence * 100)}%`;
}

function isStale(knowledge: RepositoryKnowledgeRecord): boolean {
  if (knowledge.expiresAt && knowledge.expiresAt <= new Date().toISOString()) {
    return true;
  }
  return Date.now() - new Date(knowledge.lastVerifiedAt).getTime() > 30 * 864e5;
}

function KnowledgeTable({ knowledge }: { knowledge: RepositoryKnowledgeRecord[] }) {
  const groups = useMemo(() => {
    const grouped = new Map<string, RepositoryKnowledgeRecord[]>();
    for (const item of knowledge) {
      const label = groupLabel(item.kind);
      grouped.set(label, [...(grouped.get(label) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [knowledge]);

  if (!knowledge.length) {
    return (
      <div className="intelligence-empty">
        <BookOpen aria-hidden="true" size={28} />
        <h2>No repository knowledge yet</h2>
        <p>Run the repository's first connected scan to establish its baseline.</p>
      </div>
    );
  }

  return (
    <div className="knowledge-table" aria-label="Repository knowledge">
      <div className="knowledge-columns" aria-hidden="true">
        <span>Statement</span>
        <span>Scope</span>
        <span>Confidence</span>
        <span>Source</span>
        <span>Last verified</span>
        <span>Evidence</span>
      </div>
      {groups.map(([label, items]) => (
        <section className="knowledge-group" key={label}>
          <h2>
            <ChevronDown aria-hidden="true" size={14} />
            {label} <span>({items.length})</span>
          </h2>
          {items.map((item) => (
            <details className="knowledge-row" key={item.id}>
              <summary>
                <span className="knowledge-statement">{item.statement}</span>
                <span>{item.scope.value}</span>
                <span className={item.confirmedBy ? "is-confirmed" : ""}>
                  {confidenceLabel(item)}
                </span>
                <code>{item.source.commit?.slice(0, 7) ?? item.source.type}</code>
                <time>{new Date(item.lastVerifiedAt).toLocaleDateString()}</time>
                <span className="evidence-toggle">Show</span>
              </summary>
              <div className="knowledge-evidence">
                <div>
                  <strong>Evidence</strong>
                  <ul>
                    {item.source.evidence.map((evidence) => (
                      <li key={evidence}>{evidence}</li>
                    ))}
                  </ul>
                </div>
                <dl>
                  <div>
                    <dt>Knowledge type</dt>
                    <dd>{item.kind.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>First observed</dt>
                    <dd>{new Date(item.firstObservedAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Related paths</dt>
                    <dd>{item.relatedPaths.join(", ") || "Repository-wide"}</dd>
                  </div>
                  {item.confirmedBy ? (
                    <div>
                      <dt>Confirmed by</dt>
                      <dd>@{item.confirmedBy.login}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

function QuestionWorkspace({
  questions,
  selectedId,
  onSelect,
  answer,
  onAnswerChange,
  onSubmit,
  reviewer,
  busy,
  message,
}: {
  questions: RepositoryQuestionRecord[];
  selectedId?: string;
  onSelect: (id: string) => void;
  answer: string;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
  reviewer?: ReviewerIdentity;
  busy: boolean;
  message: string;
}) {
  const open = questions.filter(({ status }) => status === "open");
  const answered = questions.filter(({ status }) => status === "answered");
  const selected =
    questions.find(({ id }) => id === selectedId) ?? open[0] ?? answered[0];

  if (!selected) {
    return (
      <div className="intelligence-empty">
        <CheckCircle2 aria-hidden="true" size={28} />
        <h2>No repository questions</h2>
        <p>The latest scan did not identify an owner ambiguity.</p>
      </div>
    );
  }

  return (
    <div className="questions-workspace">
      <aside className="question-list" aria-label="Repository questions">
        <h2>Open questions <span>{open.length}</span></h2>
        {open.map((question) => (
          <button
            className={question.id === selected.id ? "is-selected" : ""}
            key={question.id}
            onClick={() => onSelect(question.id)}
            type="button"
          >
            <CircleHelp aria-hidden="true" size={16} />
            <span>{question.question}</span>
          </button>
        ))}
        {answered.length ? (
          <>
            <h2>Answered <span>{answered.length}</span></h2>
            {answered.map((question) => (
              <button
                className={question.id === selected.id ? "is-selected" : ""}
                key={question.id}
                onClick={() => onSelect(question.id)}
                type="button"
              >
                <CheckCircle2 aria-hidden="true" size={16} />
                <span>{question.question}</span>
              </button>
            ))}
          </>
        ) : null}
      </aside>
      <section className="question-detail">
        <header>
          <span>{selected.blocking.replaceAll("_", " ")}</span>
          <h2>{selected.question}</h2>
          <p>{selected.why}</p>
        </header>
        <div className="question-context">
          <section>
            <h3>Evidence behind the question</h3>
            <ul>
              {selected.evidence.map((evidence) => (
                <li key={evidence}>{evidence}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Affected decisions</h3>
            <ul>
              {selected.affects.map((affect) => (
                <li key={affect}>{affect}</li>
              ))}
            </ul>
          </section>
        </div>
        {selected.status === "answered" ? (
          <div className="confirmed-answer">
            <ShieldCheck aria-hidden="true" size={19} />
            <div>
              <strong>Owner-confirmed answer</strong>
              <p>{selected.answer?.value}</p>
              <small>
                @{selected.answer?.identity.login} ·{" "}
                {selected.answer
                  ? new Date(selected.answer.answeredAt).toLocaleString()
                  : ""}
              </small>
            </div>
          </div>
        ) : (
          <form
            className="answer-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label htmlFor="owner-answer">Confirmed owner answer</label>
            <p>{selected.suggestedAnswers.join(" ")}</p>
            <textarea
              id="owner-answer"
              onChange={(event) => onAnswerChange(event.target.value)}
              placeholder="Describe the confirmed business fact or rule…"
              value={answer}
            />
            <div>
              {reviewer ? (
                <span>Answering as @{reviewer.login}</span>
              ) : (
                <a href="/api/auth/github">Sign in with GitHub to answer</a>
              )}
              <button disabled={!reviewer || busy || answer.trim().length < 3}>
                {busy ? "Saving…" : "Save confirmed answer"}
              </button>
            </div>
            {message ? <p role="status">{message}</p> : null}
          </form>
        )}
      </section>
    </div>
  );
}

function CustomPromiseEditor({
  repository,
  apiConnected,
  onCreated,
}: {
  repository: string;
  apiConnected: boolean;
  onCreated: (record: RepositoryKnowledgeRecord) => void;
}) {
  const [ruleId, setRuleId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"critical" | "high" | "medium" | "low">("high");
  const [command, setCommand] = useState("");
  const [allowedPaths, setAllowedPaths] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleId.trim() || !title.trim() || !command.trim()) {
      setError("Rule ID, Title, and Validation Command are required.");
      return;
    }
    setError("");
    setSuccess("");
    setSubmitting(true);

    const paths = allowedPaths
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (apiConnected) {
      try {
        const response = await fetch(`/api/repositories/${encodeURIComponent(repository)}/promises`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ruleId: ruleId.trim(),
            title: title.trim(),
            description: description.trim(),
            severity,
            command: command.trim(),
            allowedPaths: paths,
          }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to create promise.");
        }
        const data = await response.json();
        onCreated(data.promise);
        setSuccess(`Custom promise ${ruleId} signed and added successfully!`);
        setRuleId("");
        setTitle("");
        setDescription("");
        setCommand("");
        setAllowedPaths("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create promise.");
      } finally {
        setSubmitting(false);
      }
    } else {
      const mockRecord: RepositoryKnowledgeRecord = {
        id: `KNOWLEDGE-${Date.now()}`,
        repository,
        kind: "owner_confirmed_business_rule",
        statement: `Custom Business Promise [${ruleId.trim()}]: ${title.trim()} - ${description.trim()} (Validation: ${command.trim()})`,
        scope: { type: "workflow", value: "software-oath.yml" },
        source: {
          type: "owner_answer",
          questionId: `PROMISE-${ruleId.trim()}`,
          evidence: [
            `Rule ID: ${ruleId.trim()}`,
            `Severity: ${severity}`,
            `Validation Command: ${command.trim()}`,
            `Allowed Repair Paths: ${paths.join(", ") || "none"}`,
          ],
        },
        confidence: 1,
        relatedPaths: paths,
        blocksRepair: true,
        firstObservedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onCreated(mockRecord);
      setSuccess(`Custom promise ${ruleId} signed and added successfully!`);
      setRuleId("");
      setTitle("");
      setDescription("");
      setCommand("");
      setAllowedPaths("");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: "#ffffff", padding: "24px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
      <h2 style={{ fontSize: "18px", fontWeight: "700", margin: "0 0 8px 0" }}>Author Custom Business Promise</h2>
      <p style={{ color: "#64748b", fontSize: "14px", margin: "0 0 20px 0" }}>
        Declare immutable invariants, protected boundaries, or validation promises enforced by Software Oath.
      </p>

      {error && (
        <div style={{ padding: "12px", background: "#fef2f2", color: "#991b1b", borderRadius: "6px", marginBottom: "16px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: "12px", background: "#f0fdf4", color: "#166534", borderRadius: "6px", marginBottom: "16px", fontSize: "14px" }}>
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "16px", maxWidth: "680px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>
              Rule Identifier *
            </label>
            <input
              type="text"
              placeholder="e.g. payment.idempotency"
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>
              Severity *
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as any)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>
            Rule Title *
          </label>
          <input
            type="text"
            placeholder="e.g. Payments must be strictly idempotent"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            required
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>
            Rule Description
          </label>
          <textarea
            placeholder="Explain why this business invariant exists and how it must be protected..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>
            Required Validation Command *
          </label>
          <input
            type="text"
            placeholder="e.g. npm test -- payment.test.ts"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            required
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>
            Allowed Repair Paths (comma-separated)
          </label>
          <input
            type="text"
            placeholder="e.g. src/payment/store.ts, src/payment/api.ts"
            value={allowedPaths}
            onChange={(e) => setAllowedPaths(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "10px 20px",
            background: "#2563eb",
            color: "#ffffff",
            fontWeight: "600",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            justifySelf: "start",
          }}
        >
          {submitting ? "Signing & Appending Promise..." : "Sign & Append Business Promise"}
        </button>
      </form>
    </div>
  );
}

export function RepositoryIntelligence({
  initialTab,
  onTabChange,
}: {
  initialTab: IntelligenceTab;
  onTabChange: (tab: IntelligenceTab) => void;
}) {
  const [repositories, setRepositories] = useState([demoRepository]);
  const [repository, setRepository] = useState(demoRepository.repository);
  const [knowledge, setKnowledge] = useState(demoKnowledge);
  const [questions, setQuestions] = useState(demoQuestions);
  const [counts, setCounts] = useState<Record<string, number>>({
    [demoRepository.repository]: demoQuestions.length,
  });
  const [reviewer, setReviewer] = useState<ReviewerIdentity>();
  const [csrfToken, setCsrfToken] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | undefined>(
    demoQuestions[0]?.id,
  );
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadRepositories() {
      try {
        const response = await fetch("/api/repositories");
        if (!response.ok) throw new Error("Repositories unavailable");
        const payload = (await response.json()) as {
          repositories: RepositoryRegistration[];
        };
        if (active && payload.repositories.length) {
          setRepositories(payload.repositories);
          setRepository((current) =>
            payload.repositories.some((item) => item.repository === current)
              ? current
              : payload.repositories[0].repository,
          );
          setApiConnected(true);
        }
      } catch {
        // The bundled demo remains available when the control plane is offline.
      }
    }
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          authenticated: boolean;
          identity?: ReviewerIdentity;
          csrfToken?: string;
        };
        if (active) {
          setReviewer(payload.identity);
          setCsrfToken(payload.csrfToken ?? "");
        }
      } catch {
        // Offline demo.
      }
    }
    void Promise.all([loadRepositories(), loadSession()]).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!apiConnected) return;
    let active = true;
    const encoded = encodeURIComponent(repository);
    void Promise.all([
      fetch(`/api/repositories/${encoded}/knowledge`, {
        credentials: "same-origin",
      }),
      fetch(`/api/repositories/${encoded}/questions`, {
        credentials: "same-origin",
      }),
    ])
      .then(async ([knowledgeResponse, questionsResponse]) => {
        if (knowledgeResponse.status === 401 || questionsResponse.status === 401) {
          if (active) setUnauthorized(true);
          return;
        }
        if (!knowledgeResponse.ok || !questionsResponse.ok) {
          throw new Error("Repository intelligence is unavailable.");
        }
        const knowledgePayload = (await knowledgeResponse.json()) as {
          knowledge: RepositoryKnowledgeRecord[];
        };
        const questionPayload = (await questionsResponse.json()) as {
          questions: RepositoryQuestionRecord[];
        };
        if (active) {
          setUnauthorized(false);
          setKnowledge(knowledgePayload.knowledge);
          setQuestions(questionPayload.questions);
          setCounts((current) => ({
            ...current,
            [repository]: questionPayload.questions.filter(
              ({ status }) => status === "open",
            ).length,
          }));
          setSelectedQuestionId(
            questionPayload.questions.find(({ status }) => status === "open")?.id,
          );
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Repository intelligence is unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiConnected, repository, reloadKey]);

  useEffect(() => {
    if (!apiConnected || repositories.length === 0) return;
    let active = true;
    void Promise.all(
      repositories.map(async (candidate) => {
        const response = await fetch(
          `/api/repositories/${encodeURIComponent(candidate.repository)}/questions`,
          { credentials: "same-origin" },
        );
        if (!response.ok) return [candidate.repository, 0] as const;
        const payload = (await response.json()) as {
          questions: RepositoryQuestionRecord[];
        };
        return [
          candidate.repository,
          payload.questions.filter(({ status }) => status === "open").length,
        ] as const;
      }),
    )
      .then((entries) => {
        if (active) setCounts(Object.fromEntries(entries));
      })
      .catch(() => {
        // The selected repository request owns the visible error state.
      });
    return () => {
      active = false;
    };
  }, [apiConnected, repositories, reloadKey]);

  const openQuestions = questions.filter(({ status }) => status === "open");
  const stale = knowledge.filter(isStale);
  const observed = knowledge.filter(({ kind }) =>
    ["observed_technical_fact", "repository_enforced_rule"].includes(kind),
  );
  const activeWorkspaces = knowledge.filter(
    ({ statement }) => statement.includes("workspace with active"),
  );
  const coverageGaps = knowledge.filter(({ statement }) =>
    statement.includes("coverage gap"),
  );

  async function submitAnswer() {
    const question = questions.find(({ id }) => id === selectedQuestionId);
    if (!question || !reviewer || !csrfToken || answer.trim().length < 3) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/repositories/${encodeURIComponent(repository)}/questions/${encodeURIComponent(question.id)}/answer`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ answer }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        question?: RepositoryQuestionRecord;
        knowledge?: RepositoryKnowledgeRecord;
      };
      if (!response.ok || !payload.question || !payload.knowledge) {
        throw new Error(payload.error ?? "Answer could not be saved.");
      }
      setQuestions((current) =>
        current.map((item) =>
          item.id === payload.question!.id ? payload.question! : item,
        ),
      );
      setKnowledge((current) => [payload.knowledge!, ...current]);
      setCounts((current) => ({
        ...current,
        [repository]: Math.max(0, (current[repository] ?? 1) - 1),
      }));
      setAnswer("");
      setMessage("Answer saved as owner-confirmed knowledge. Run a fresh scan when ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Answer failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runScan() {
    if (!csrfToken) {
      setMessage("Sign in with GitHub before triggering a scan.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/repositories/${encodeURIComponent(repository)}/scan`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-CSRF-Token": csrfToken },
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Scan could not be started.");
      }
      setMessage("Fresh repository scan queued.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab = initialTab === "Knowledge" ? "Questions" : "Knowledge";
    onTabChange(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(`intelligence-tab-${nextTab}`)?.focus();
    });
  }

  return (
    <>
      <main className="intelligence-canvas">
        <header className="intelligence-header">
          <div>
            <h1>Repository intelligence</h1>
            <p>
              <FileCode2 aria-hidden="true" size={15} />
              {repository}
              <span>Healthy</span>
              {activeWorkspaces.length || 1} active workspace
              <span>·</span>
              {coverageGaps.length} coverage gaps
            </p>
          </div>
          <a
            href={`https://github.com/${repository}`}
            rel="noreferrer"
            target="_blank"
          >
            View on GitHub <ExternalLink aria-hidden="true" size={14} />
          </a>
        </header>

        <div className="intelligence-tabs" role="tablist">
          {(["Knowledge", "Questions", "Custom Promises"] as const).map((tab) => (
            <button
              aria-controls={`intelligence-panel-${tab}`}
              aria-selected={initialTab === tab}
              className={initialTab === tab ? "is-selected" : ""}
              id={`intelligence-tab-${tab}`}
              key={tab}
              onClick={() => onTabChange(tab)}
              onKeyDown={handleTabKeyDown}
              role="tab"
              type="button"
            >
              {tab}
              {tab === "Questions" && openQuestions.length ? (
                <span>{openQuestions.length}</span>
              ) : null}
            </button>
          ))}
        </div>

        <section className="capability-strip" aria-label="Repository capability status">
          <div>
            <span>Workspace</span>
            <strong>npm · active</strong>
          </div>
          <div>
            <span>Knowledge state</span>
            <strong>
              <CheckCircle2 aria-hidden="true" size={14} />
              Synchronized
            </strong>
          </div>
          <div>
            <span>Coverage gaps</span>
            <strong>{coverageGaps.length}</strong>
          </div>
        </section>

        <div
          aria-labelledby={`intelligence-tab-${initialTab}`}
          id={`intelligence-panel-${initialTab}`}
          role="tabpanel"
        >
        {loading ? (
          <div className="intelligence-state" role="status">
            <RefreshCw aria-hidden="true" className="is-spinning" size={20} />
            Loading repository intelligence…
          </div>
        ) : unauthorized ? (
          <div className="intelligence-state">
            <ShieldCheck aria-hidden="true" size={24} />
            <h2>Owner authentication required</h2>
            <p>Repository knowledge is private and requires live GitHub access.</p>
            <a href="/api/auth/github">Sign in with GitHub</a>
          </div>
        ) : loadError ? (
          <div className="intelligence-state" role="alert">
            <AlertTriangle aria-hidden="true" size={24} />
            <h2>Could not load repository intelligence</h2>
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadError("");
                setLoading(true);
                setReloadKey((key) => key + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : initialTab === "Knowledge" ? (
          <KnowledgeTable knowledge={knowledge} />
        ) : initialTab === "Custom Promises" ? (
          <CustomPromiseEditor
            repository={repository}
            apiConnected={apiConnected}
            onCreated={(record) => setKnowledge((prev) => [record, ...prev])}
          />
        ) : (
          <QuestionWorkspace
            answer={answer}
            busy={busy}
            message={message}
            onAnswerChange={setAnswer}
            onSelect={(id) => {
              setSelectedQuestionId(id);
              setAnswer("");
              setMessage("");
            }}
            onSubmit={() => void submitAnswer()}
            questions={questions}
            reviewer={reviewer}
            selectedId={selectedQuestionId}
          />
        )}
        </div>
      </main>

      <aside className="intelligence-rail">
        <h2>Repository context</h2>
        <div className="context-metrics">
          <button onClick={() => onTabChange("Questions")} type="button">
            <CircleHelp aria-hidden="true" size={22} />
            <span>
              <strong>{openQuestions.length}</strong>
              Open questions
            </span>
            <ChevronDown aria-hidden="true" size={15} />
          </button>
          <div>
            <Eye aria-hidden="true" size={22} />
            <span>
              <strong>{observed.length}</strong>
              Observed facts
            </span>
          </div>
          <div>
            <Clock3 aria-hidden="true" size={22} />
            <span>
              <strong>{stale.length}</strong>
              Stale items
            </span>
          </div>
        </div>
        <button
          className="review-questions"
          onClick={() => onTabChange("Questions")}
          type="button"
        >
          Review questions
        </button>
        <button
          className="run-scan"
          disabled={busy}
          onClick={() => void runScan()}
          type="button"
        >
          <ScanSearch aria-hidden="true" size={15} />
          Run scan
        </button>
        {message ? (
          <p className="rail-message" role="status">{message}</p>
        ) : null}
        <dl className="repository-facts">
          <div>
            <dt>Last scan</dt>
            <dd>
              {new Date(
                repositories.find((item) => item.repository === repository)
                  ?.lastRunAt ?? demoRepository.lastRunAt!,
              ).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Default branch</dt>
            <dd>
              {repositories.find((item) => item.repository === repository)
                ?.defaultBranch ?? "main"}
            </dd>
          </div>
          <div>
            <dt>Repository</dt>
            <dd>{repository}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{apiConnected ? "Connected" : "Local demo"}</dd>
          </div>
        </dl>
        <label className="repository-picker">
          Repository
          <select
            onChange={(event) => {
              setLoading(true);
              setUnauthorized(false);
              setLoadError("");
              setRepository(event.target.value);
            }}
            value={repository}
          >
            {repositories.map((item) => (
              <option key={item.id} value={item.repository}>
                {item.repository} · {counts[item.repository] ?? 0} questions
              </option>
            ))}
          </select>
        </label>
        {coverageGaps.length ? (
          <p className="coverage-warning">
            <AlertTriangle aria-hidden="true" size={15} />
            {coverageGaps.length} workspace coverage gaps require owner review.
          </p>
        ) : null}
      </aside>
    </>
  );
}

// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RepositoryKnowledgeRecord,
  RepositoryQuestionRecord,
  RepositoryRegistration,
} from "../control-plane/types";
import { RepositoryIntelligence } from "./RepositoryIntelligence";

const repository: RepositoryRegistration = {
  id: "REPOSITORY-1",
  repository: "owner/repo",
  cloneUrl: "https://github.com/owner/repo.git",
  defaultBranch: "main",
  schedule: { mode: "weekly", timezone: "UTC" },
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

const knowledge: RepositoryKnowledgeRecord = {
  id: "KNOWLEDGE-1",
  repository: "owner/repo",
  kind: "observed_technical_fact",
  statement: ". is an npm workspace with active Software Oath support.",
  scope: { type: "workspace", value: "." },
  source: {
    type: "scan",
    commit: "abcdef123",
    evidence: ["package.json", "package-lock.json"],
  },
  confidence: 1,
  relatedPaths: ["package.json"],
  blocksRepair: false,
  firstObservedAt: "2026-07-30T12:00:00Z",
  lastVerifiedAt: "2026-07-30T12:00:00Z",
  createdAt: "2026-07-30T12:00:00Z",
  updatedAt: "2026-07-30T12:00:00Z",
};

const question: RepositoryQuestionRecord = {
  id: "QUESTION-1",
  repository: "owner/repo",
  key: "onboarding.business-purpose",
  status: "open",
  question: "What does this product do?",
  why: "Code cannot confirm business intent.",
  evidence: ["README.md"],
  affects: ["business scope"],
  suggestedAnswers: ["Describe the product and its users."],
  authorizedRole: "repository_write",
  blocking: "affected_repair",
  answerKnowledgeKind: "owner_confirmed_business_fact",
  createdAt: "2026-07-30T12:00:00Z",
  updatedAt: "2026-07-30T12:00:00Z",
};

function response(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function Fixture() {
  const [tab, setTab] = useState<any>("Knowledge");
  return <RepositoryIntelligence initialTab={tab} onTabChange={setTab} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository intelligence workspace", () => {
  it("loads private repository knowledge with provenance and question counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/repositories") {
          return response({ repositories: [repository] });
        }
        if (url === "/api/auth/session") {
          return response({
            authenticated: true,
            identity: {
              provider: "github",
              providerUserId: "42",
              login: "owner",
            },
            csrfToken: "csrf-token",
          });
        }
        if (url.endsWith("/knowledge")) {
          return response({ knowledge: [knowledge] });
        }
        if (url.endsWith("/questions")) {
          return response({ questions: [question] });
        }
        return response({ error: "Not found" }, 404);
      }),
    );

    render(<Fixture />);

    expect(
      await screen.findByText(
        ". is an npm workspace with active Software Oath support.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "owner/repo · 1 questions" }),
      ).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByText(
        ". is an npm workspace with active Software Oath support.",
      ),
    );
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    expect(screen.getByText("abcdef1")).toBeInTheDocument();

    const knowledgeTab = screen.getByRole("tab", { name: "Knowledge" });
    await userEvent.click(knowledgeTab);
    await userEvent.keyboard("{ArrowRight}");
    expect(
      await screen.findByRole("heading", { name: "What does this product do?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Questions/ })).toHaveFocus();
  });

  it("answers a question with CSRF and can queue a fresh scan", async () => {
    const answeredQuestion: RepositoryQuestionRecord = {
      ...question,
      status: "answered",
      answer: {
        value: "A service for store operators to manage orders.",
        identity: {
          provider: "github",
          providerUserId: "42",
          login: "owner",
        },
        authorization: {
          repository: "owner/repo",
          permission: "maintain",
          verifiedAt: "2026-07-30T12:05:00Z",
        },
        answeredAt: "2026-07-30T12:05:00Z",
      },
      knowledgeId: "KNOWLEDGE-ANSWER",
    };
    const confirmed: RepositoryKnowledgeRecord = {
      ...knowledge,
      id: "KNOWLEDGE-ANSWER",
      kind: "owner_confirmed_business_fact",
      statement: "A service for store operators to manage orders.",
      confirmedBy: answeredQuestion.answer!.identity,
    };
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/repositories") {
          return response({ repositories: [repository] });
        }
        if (url === "/api/auth/session") {
          return response({
            authenticated: true,
            identity: answeredQuestion.answer!.identity,
            csrfToken: "csrf-token",
          });
        }
        if (url.endsWith("/knowledge")) {
          return response({ knowledge: [knowledge] });
        }
        if (url.endsWith("/questions") && !init?.method) {
          return response({ questions: [question] });
        }
        if (url.endsWith(`/questions/${question.id}/answer`)) {
          expect(init?.headers).toMatchObject({
            "X-CSRF-Token": "csrf-token",
          });
          return response({
            question: answeredQuestion,
            knowledge: confirmed,
          });
        }
        if (url.endsWith("/scan")) {
          expect(init?.headers).toMatchObject({
            "X-CSRF-Token": "csrf-token",
          });
          return response({ run: { id: "RUN-2" } }, 202);
        }
        return response({ error: "Not found" }, 404);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Fixture />);

    await user.click(await screen.findByRole("tab", { name: /Questions/ }));
    expect(
      await screen.findByRole("heading", { name: "What does this product do?" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Confirmed owner answer"),
      "A service for store operators to manage orders.",
    );
    await user.click(
      screen.getByRole("button", { name: "Save confirmed answer" }),
    );

    expect(await screen.findByText("Owner-confirmed answer")).toBeInTheDocument();
    expect(
      screen.getByText("A service for store operators to manage orders."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run scan" }));
    expect(await screen.findByText("Fresh repository scan queued.")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/repositories/owner%2Frepo/scan",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("renders custom promise authoring form and allows submitting custom promises", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/repositories") return response({ repositories: [repository] });
      if (url === "/api/auth/session") {
        return response({
          authenticated: true,
          identity: { provider: "github", providerUserId: "42", login: "owner" },
          csrfToken: "csrf-token",
        });
      }
      if (url.endsWith("/knowledge")) return response({ knowledge: [knowledge] });
      if (url.endsWith("/questions")) return response({ questions: [question] });
      return response({ error: "Not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Fixture />);

    const promiseTab = await screen.findByRole("tab", { name: "Custom Promises" });
    expect(promiseTab).toBeInTheDocument();
    await userEvent.click(promiseTab);

    expect(screen.getByText("Author Custom Business Promise")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. payment.idempotency")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign & Append Business Promise" })).toBeInTheDocument();
  });
});

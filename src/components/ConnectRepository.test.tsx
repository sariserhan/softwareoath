// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectRepository } from "./ConnectRepository";

afterEach(() => vi.unstubAllGlobals());

function response(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

const oathSource = [
  "version: 1",
  "application:",
  "  name: Fixture",
  "  repository: owner/repo",
  "  defaultBranch: main",
  "approval:",
  "  requireHumanFor: [critical]",
  "  allowAutomaticMerge: false",
  "rules:",
  "  - id: application.tests",
  "    title: Tests remain green",
  "    description: Tests must pass.",
  "    severity: high",
  "    evidence:",
  "      - kind: test",
  "        command: npm test",
  "        required: true",
].join("\n");

describe("repository onboarding", () => {
  it("offers GitHub sign-in when no owner session exists", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ authenticated: false })));
    render(<ConnectRepository />);
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" }))
      .toHaveAttribute("href", "/api/auth/github");
  });

  it("registers an eligible App repository and queues its first scan", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return response({
          authenticated: true,
          csrfToken: "csrf",
          identity: { login: "owner" },
        });
      }
      if (url === "/api/github/repositories") {
        return response({
          organizations: [{ login: "owner" }],
          repositories: [{
            repository: "owner/repo",
            cloneUrl: "https://github.com/owner/repo.git",
            defaultBranch: "main",
            installationId: 42,
            private: true,
          }],
        });
      }
      if (url === "/api/repositories") return response({ repository: {} });
      if (url.includes("/oath-proposal")) {
        return response({
          proposal: { html_url: "https://github.test/owner/repo/pull/7" },
        }, 201);
      }
      if (url.includes("/oath-draft")) {
        return response({
          draft: { source: oathSource, warnings: ["Review rules."], generatedAt: "2026-08-24T00:00:00Z" },
        });
      }
      if (url.includes("/scan")) return response({ run: { id: "RUN-1" } }, 202);
      return response({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ConnectRepository />);

    await screen.findByText("owner/repo · private");
    expect(screen.getByLabelText("Accessible organizations")).toHaveTextContent("owner");
    await user.click(screen.getByRole("button", { name: "Register repository" }));
    await screen.findByText("Repository registered. Start the first read-only scan.");
    await user.click(screen.getByRole("button", { name: /Start first scan/ }));
    await screen.findByText("First scan queued. Follow its progress in Runs.");
    await user.click(screen.getByRole("button", { name: "Review generated oath" }));
    await screen.findByText("Schema valid");
    expect(screen.getByLabelText("Oath summary")).toHaveTextContent("Tests remain green");
    await user.click(screen.getByRole("button", { name: "Propose oath as draft PR" }));
    expect(await screen.findByRole("link", { name: "Review draft oath pull request" }))
      .toHaveAttribute("href", "https://github.test/owner/repo/pull/7");
    await user.clear(screen.getByLabelText("Initial oath YAML"));
    await user.type(screen.getByLabelText("Initial oath YAML"), "version: 2");
    expect(screen.getByRole("alert")).toHaveTextContent("Schema error");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/repositories/owner%2Frepo/oath-proposal",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-CSRF-Token": "csrf" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/repositories/owner%2Frepo/scan",
        expect.objectContaining({
          method: "POST",
          headers: { "X-CSRF-Token": "csrf" },
        }),
      ),
    );
  });
});

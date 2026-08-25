// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";

function emptyApi(input: RequestInfo | URL) {
  const url = String(input);
  const payload = url === "/api/repositories"
    ? { repositories: [] }
    : url === "/api/runs"
      ? { runs: [] }
      : { authenticated: false };
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("Software Oath workspace", () => {
  it("serves the public product homepage at the root route", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /Software that keeps its promises/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dependency Optimizer" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open dashboard/i })[0])
      .toHaveAttribute("href", "/dashboard");
  });

  it("shows an authoritative empty incident state without demo fallback", async () => {
    window.history.replaceState({}, "", "/dashboard");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(emptyApi));
    render(<App />);
    expect(await screen.findByTestId("review-empty")).toHaveTextContent("No incidents yet");
    expect(screen.queryByText("Local demo operational")).not.toBeInTheDocument();
  });

  it("restores the selected production view from the URL", async () => {
    window.history.replaceState({}, "", "/dashboard?view=Analytics");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(emptyApi));
    render(<App />);
    expect(await screen.findByTestId("analytics-empty")).toHaveTextContent("Connect a repository");
    expect(screen.getByRole("button", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
  });

  it("navigates to authoritative run history and records the route", async () => {
    window.history.replaceState({}, "", "/dashboard");
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Runs" }));
    expect(screen.getByRole("heading", { name: "Repair runs" })).toBeInTheDocument();
    expect(await screen.findByTestId("runs-load-error")).toHaveTextContent("Repair runs unavailable");
    expect(new URLSearchParams(window.location.search).get("view")).toBe("Runs");
  });
});

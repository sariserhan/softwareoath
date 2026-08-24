// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunHistory } from "./RunHistory";

afterEach(() => vi.unstubAllGlobals());

function response(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("RunHistory authoritative states", () => {
  it("shows an empty state instead of bundled demo runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input) === "/api/runs"
          ? response({ runs: [] })
          : response({ authenticated: false }),
      ),
    );
    render(<RunHistory />);

    expect(await screen.findByTestId("runs-empty")).toHaveTextContent(
      "No repair runs yet",
    );
    expect(screen.queryByText("acme/storefront")).not.toBeInTheDocument();
  });

  it("shows a disconnected state and retries explicitly", async () => {
    let runRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) !== "/api/runs") {
          return response({ authenticated: false });
        }
        runRequests += 1;
        return runRequests <= 3
          ? response({ error: "Control plane unavailable." }, 503)
          : response({ runs: [] });
      }),
    );
    const user = userEvent.setup();
    render(<RunHistory />);

    expect(await screen.findByTestId("runs-load-error")).toHaveTextContent(
      "Control plane unavailable.",
    );
    await user.click(screen.getByRole("button", { name: "Retry runs" }));
    expect(await screen.findByTestId("runs-empty")).toBeInTheDocument();
  });

  it("surfaces reviewer permission failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input) === "/api/runs"
          ? response({ runs: [] })
          : response({ error: "Repository access denied." }, 403),
      ),
    );
    render(<RunHistory />);

    expect(await screen.findByTestId("runs-session-error")).toHaveTextContent(
      "Review permission denied",
    );
  });
});

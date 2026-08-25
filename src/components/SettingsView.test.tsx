// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsView } from "./SettingsView.js";

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function repository(name: string, branch: string, scheduled = true) {
  return {
    id: `REPO-${name}`,
    repository: name,
    cloneUrl: `https://github.com/${name}.git`,
    defaultBranch: branch,
    schedule: {
      mode: scheduled ? "weekly" : "disabled",
      timezone: "UTC",
    },
    policy: {
      maxPullRequestsPerRun: 1,
      maxCiRepairAttempts: 2,
      allowMajorPackageUpdates: false,
      automaticMerge: false,
    },
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

afterEach(() => vi.restoreAllMocks());

describe("SettingsView", () => {
  it("loads authoritative repository settings and switches repositories", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          repositories: [
            repository("owner/one", "main"),
            repository("owner/two", "trunk"),
          ],
        }),
      ),
    );

    render(<SettingsView />);
    expect(screen.getByText("Loading repository settings…")).toBeTruthy();
    expect(await screen.findByText("Configure stewardship behavior for owner/one")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "owner/two" },
    });
    expect(screen.getByText("trunk")).toBeTruthy();
  });

  it("renders an empty state without substituting demo settings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ repositories: [] })));
    render(<SettingsView />);
    expect(await screen.findByTestId("settings-empty")).toBeTruthy();
    expect(screen.getByText(/No repositories are connected/)).toBeTruthy();
  });

  it("surfaces permission errors and retries", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ error: "Repository access denied." }, 403))
      .mockResolvedValueOnce(response({ repositories: [repository("owner/repo", "main")] }));
    vi.stubGlobal("fetch", fetcher);
    render(<SettingsView />);

    expect(await screen.findByText("Settings permission denied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Configure stewardship behavior for owner/repo")).toBeTruthy();
  });
});

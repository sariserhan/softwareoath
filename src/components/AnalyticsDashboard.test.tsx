// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { DashboardDataProvider } from "./DashboardData";

describe("AnalyticsDashboard", () => {
  it("renders an authoritative empty state", () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input) => {
      const url = String(input);
      const payload = url === "/api/repositories"
        ? { repositories: [] }
        : url === "/api/runs"
          ? { runs: [] }
          : { authenticated: false };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    }));
    render(<DashboardDataProvider><AnalyticsDashboard /></DashboardDataProvider>);

    return screen.findByTestId("analytics-empty").then((empty) => {
      expect(empty).toHaveTextContent("Connect a repository");
    });
  });
});

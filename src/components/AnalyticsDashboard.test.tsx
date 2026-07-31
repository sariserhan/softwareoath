// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

describe("AnalyticsDashboard", () => {
  it("renders KPI cards with computed metrics", () => {
    render(<AnalyticsDashboard />);

    expect(screen.getByTestId("analytics-dashboard")).toBeTruthy();
    expect(screen.getByText("Stewardship Analytics")).toBeTruthy();
    expect(screen.getByText("Total Repairs")).toBeTruthy();
    expect(screen.getByText("Pass Rate")).toBeTruthy();
    expect(screen.getByText("Avg MTTR")).toBeTruthy();
    expect(screen.getByText("Active Findings")).toBeTruthy();
  });

  it("renders all four chart sections", () => {
    render(<AnalyticsDashboard />);

    expect(screen.getByText("Repair Success Rate")).toBeTruthy();
    expect(screen.getByText("Mean Time to Repair")).toBeTruthy();
    expect(screen.getByText("Finding Frequency")).toBeTruthy();
    expect(screen.getByText("Decision Distribution")).toBeTruthy();
  });

  it("renders finding categories in horizontal bar chart", () => {
    render(<AnalyticsDashboard />);

    expect(screen.getByText("Dependencies")).toBeTruthy();
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.getByText("Tests")).toBeTruthy();
    expect(screen.getByText("Custom Rules")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IncidentReplayWorkspace } from "./IncidentReplayWorkspace";

describe("IncidentReplayWorkspace", () => {
  it("renders benchmark summary KPI cards and incident list", () => {
    render(<IncidentReplayWorkspace />);

    expect(screen.getByText("Historical Incident Replays & Benchmarks")).toBeDefined();
    expect(screen.getByText("Total Incidents")).toBeDefined();
    expect(screen.getByText("Reproduction Rate")).toBeDefined();
    expect(screen.getByText("AI Repair Pass Rate")).toBeDefined();
    expect(screen.getByText("Exact Patch Match")).toBeDefined();
    expect(screen.getAllByText("Memory leak in event dispatcher loop").length).toBeGreaterThan(0);
  });

  it("switches selected incident on click and renders details", () => {
    render(<IncidentReplayWorkspace />);

    const secondIncidentButtons = screen.getAllByText("Unhandled null reference in auth token verify");
    fireEvent.click(secondIncidentButtons[0]);

    expect(screen.getAllByText("planetnode-002").length).toBeGreaterThan(0);
    expect(screen.getByText("b2c3d4e")).toBeDefined();
    expect(screen.getByText("f6g7h8i")).toBeDefined();
    expect(screen.getByText("Behavioral Match (Semantically Equivalent)")).toBeDefined();
  });
});

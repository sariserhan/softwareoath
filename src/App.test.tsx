import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("Software Oath workspace", () => {
  it("gates approval until the human review item is acknowledged", async () => {
    const user = userEvent.setup();
    render(<App />);

    const approve = screen.getByRole("button", { name: "Approve pull request" });
    expect(approve).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", {
        name: "I reviewed and acknowledge the human-review item.",
      }),
    );
    expect(approve).toBeEnabled();

    await user.click(approve);
    expect(screen.getByText("Repair approved")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("switches between evidence views", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Tests" }));
    expect(
      screen.getByText("Authorization suite passed without changes."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Receipt" }));
    expect(screen.getByText("Deterministic local engine")).toBeInTheDocument();
  });

  it("shows connected run history and its approval form", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Runs" }));

    expect(screen.getByRole("heading", { name: "Repair runs" })).toBeInTheDocument();
    expect(screen.getByLabelText("Repair run history")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sign in with GitHub to review" }),
    ).toBeInTheDocument();
  });
});

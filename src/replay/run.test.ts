import { describe, expect, it } from "vitest";

import { parseReplaySpec } from "./run.js";

describe("historical replay specification", () => {
  it("parses a bounded historical incident", () => {
    expect(
      parseReplaySpec(`
version: 1
id: pricing-crash
title: Pricing crashes on string hardware
baseCommit: abc123
humanFixCommit: def456
findingId: oath-check-pricing
expectedChangedPaths:
  - services/api/app/pricing.py
preparationPatch: fixtures/pricing.patch
`),
    ).toMatchObject({
      id: "pricing-crash",
      baseCommit: "abc123",
      humanFixCommit: "def456",
      expectedChangedPaths: ["services/api/app/pricing.py"],
      preparationPatch: "fixtures/pricing.patch",
    });
  });
});

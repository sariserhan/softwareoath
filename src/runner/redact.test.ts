import { describe, expect, it } from "vitest";
import { redactSensitiveOutput } from "./redact";

describe("runner output redaction", () => {
  it("redacts common credentials while retaining useful surrounding output", () => {
    const output = redactSensitiveOutput([
      "before",
      "Authorization: Bearer top-secret-value",
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456",
      "INFRACOST_API_KEY=ico-secret-value",
      "github_pat_abcdefghijklmnopqrstuvwxyz123456",
      "-----BEGIN PRIVATE KEY-----",
      "private-material",
      "-----END PRIVATE KEY-----",
      "after",
    ].join("\n"));
    expect(output).toContain("before");
    expect(output).toContain("after");
    expect(output).not.toContain("top-secret-value");
    expect(output).not.toContain("private-material");
    expect(output).not.toContain("ghp_");
    expect(output).not.toContain("github_pat_");
    expect(output).not.toContain("ico-secret-value");
  });
});

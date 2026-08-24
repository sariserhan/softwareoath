import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("GitHub Action and Workflow definitions", () => {
  it("validates action.yml composite manifest structure", async () => {
    const content = await readFile(join(process.cwd(), "action.yml"), "utf8");
    const manifest = parse(content) as {
      name: string;
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
      runs: { using: string };
    };

    expect(manifest.name).toBe("Software Oath");
    expect(manifest.inputs.command).toBeDefined();
    expect(manifest.inputs["receipt-private-key"]).toBeDefined();
    expect(manifest.outputs["has-repair"]).toBeDefined();
    expect(manifest.runs.using).toBe("composite");
  });

  it("validates split-permission software-oath.yml workflow format", async () => {
    const content = await readFile(
      join(process.cwd(), ".github", "workflows", "software-oath.yml"),
      "utf8",
    );
    const workflow = parse(content) as {
      name: string;
      jobs: Record<string, { permissions: Record<string, string> }>;
    };

    expect(workflow.name).toContain("Software Oath");
    expect(workflow.jobs["stewardship-repair"]).toBeDefined();
    expect(workflow.jobs["stewardship-repair"].permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
    });
    expect(workflow.jobs["submit-verified-pr"]).toBeDefined();
    expect(workflow.jobs["submit-verified-pr"].permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
    });
  });
});

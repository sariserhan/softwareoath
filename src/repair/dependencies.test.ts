import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepositoryFinding } from "../detector/types";
import { ConservativeDependencyRepairAgent } from "./dependencies";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conservative dependency repair agent", () => {
  it("delegates non-npm work to the bounded general repair agent", async () => {
    const fallback = {
      name: "fallback",
      repair: vi.fn(async () => ({ summary: "fallback", output: "done" })),
    };
    const agent = new ConservativeDependencyRepairAgent(fallback);
    await expect(agent.repair({
      workspacePath: "C:/fixture",
      prompt: "repair",
    })).resolves.toEqual({ summary: "fallback", output: "done" });
    expect(fallback.repair).toHaveBeenCalledOnce();
  });

  it("uses npm lockfile-only mode and disables scripts for an authorized target", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-dependency-repair-"));
    roots.push(root);
    const finding: RepositoryFinding = {
      id: "npm-outdated-package-json-is-number",
      detector: "npm-outdated",
      category: "dependencies",
      severity: "low",
      title: "update",
      summary: "update",
      evidence: { path: "package.json", detail: "fixture" },
      repair: {
        objective: "update",
        allowedPaths: ["package.json", "package-lock.json"],
        automaticCandidate: true,
      },
      dependency: {
        ecosystem: "npm",
        packageName: "is-number",
        currentVersion: "7.0.0",
        targetVersion: "7.0.0",
        manifestPath: "package.json",
        lockfilePath: "package-lock.json",
        updateKind: "patch",
      },
    };
    const executor = vi.fn(async () => ({ stdout: "updated", stderr: "" }));
    const agent = new ConservativeDependencyRepairAgent(
      {
        name: "fallback",
        async repair() {
          throw new Error("fallback should not run");
        },
      },
      executor,
    );
    const result = await agent.repair({
      workspacePath: root,
      prompt: "repair",
      finding,
    });

    expect(result.summary).toContain("lifecycle scripts disabled");
    const [command, args, cwd] = executor.mock.calls[0];
    expect(command).toBeTruthy();
    expect(args.slice(-6)).toEqual([
      "install",
      "is-number@7.0.0",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    expect(cwd).toBe(root);
  });
});

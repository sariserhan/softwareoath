import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";

import { analyzeRepositoryIsolated } from "./isolated.js";

const valid = {
  version: 1,
  commit: "a".repeat(40),
  filesAnalyzed: 1,
  bytesAnalyzed: 10,
  observations: [],
  capabilities: [],
  unknowns: [],
  signals: [],
  warnings: [],
  analyzerVersion: "optimizer-static-o1",
};

describe("isolated optimizer analyzer", () => {
  it("uses a read-only trusted runner without network or repository commands", async () => {
    const output = "SOFTWARE_OATH_ANALYSIS_GZIP_V1:" +
      gzipSync(JSON.stringify(valid)).toString("base64");
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      output,
      durationMs: 1,
    });
    await expect(analyzeRepositoryIsolated({
      repositoryPath: "/workspace/repository",
      runner: { name: "fixture", execute },
    })).resolves.toEqual(valid);
    expect(execute).toHaveBeenCalledWith({
      command: "tsx /opt/software-oath/scripts/optimizer-analyze.ts",
      workspacePath: "/workspace/repository",
      timeoutMs: 120_000,
      readOnly: true,
    });
  });

  it("fails closed on invalid output and analyzer failure", async () => {
    await expect(analyzeRepositoryIsolated({
      repositoryPath: "/workspace/repository",
      runner: { name: "fixture", execute: async () => ({
        exitCode: 0, output: "{}", durationMs: 1,
      }) },
    })).rejects.toThrow("invalid result");
    await expect(analyzeRepositoryIsolated({
      repositoryPath: "/workspace/repository",
      runner: { name: "fixture", execute: async () => ({
        exitCode: 2, output: "failed", durationMs: 1,
      }) },
    })).rejects.toThrow("exited with code 2");
  });
});

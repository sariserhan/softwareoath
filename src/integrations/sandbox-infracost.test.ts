import { describe, expect, it, vi } from "vitest";

import type { TrustedRunner } from "../runner/types.js";
import { RunnerInfracostScanner } from "./sandbox-infracost.js";

describe("RunnerInfracostScanner", () => {
  it("runs the fixed command with a validated currency", async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: '{"currency":"EUR"}',
      durationMs: 25,
    });
    const runner: TrustedRunner = {
      name: "sandbox",
      identity: async () => "sandbox@sha256:test",
      execute,
    };

    const result = await new RunnerInfracostScanner(runner).scan("/repo", "EUR");

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.stringContaining("INFRACOST_CURRENCY=EUR"),
      workspacePath: "/repo",
    }));
    expect(result).toEqual({
      output: '{"currency":"EUR"}',
      durationMs: 25,
      runner: "sandbox@sha256:test",
    });
  });

  it("rejects currency input that could alter the command", async () => {
    const runner = { name: "sandbox", execute: vi.fn() } as unknown as TrustedRunner;
    await expect(new RunnerInfracostScanner(runner).scan("/repo", "USD;env"))
      .rejects.toThrow("Invalid cost currency");
    expect(runner.execute).not.toHaveBeenCalled();
  });
});

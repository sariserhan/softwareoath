import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { VercelSandboxTrustedRunner } from "./vercel-sandbox.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  delete process.env.VERCEL;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "software-oath-sandbox-test-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
  await execFileAsync("git", ["add", "package.json"], { cwd: root });
  return root;
}

describe("VercelSandboxTrustedRunner", () => {
  it("requires an immutable production image", () => {
    process.env.VERCEL = "1";
    expect(() => new VercelSandboxTrustedRunner({
      image: "software-oath-runner:latest",
      network: "none",
    })).toThrow("sha256");
  });

  it("uploads, executes, restores, and stops an ephemeral workspace", async () => {
    const workspace = await repository();
    let archive: Uint8Array | undefined;
    const stop = vi.fn().mockResolvedValue(undefined);
    const commands: string[] = [];
    const runner = new VercelSandboxTrustedRunner({
      image: "software-oath-runner:test",
      network: "none",
      createSandbox: async () => ({
        writeFiles: async (files) => { archive = files[0].content; },
        runCommand: async ({ args }) => {
          commands.push(args?.at(-1) ?? "");
          return {
            exitCode: 0,
            durationMs: 12,
            output: async () => "verified\n",
          };
        },
        downloadFile: async (_source, destination) => {
          if (!archive) return null;
          await writeFile(destination.path, archive);
          return destination.path;
        },
        stop,
      }),
    });

    const result = await runner.execute({
      command: "npm test",
      workspacePath: workspace,
      timeoutMs: 30_000,
    });

    expect(result).toEqual({ exitCode: 0, output: "verified\n", durationMs: 12 });
    expect(commands).toContain("npm test");
    expect(stop).toHaveBeenCalledOnce();
    expect(await readFile(join(workspace, "package.json"), "utf8"))
      .toBe('{"name":"fixture"}\n');
  });

  it("discards read-only analyzer workspace changes without downloading them", async () => {
    const workspace = await repository();
    const downloadFile = vi.fn();
    const stop = vi.fn().mockResolvedValue(undefined);
    const commands: string[] = [];
    const runner = new VercelSandboxTrustedRunner({
      image: "software-oath-runner:test",
      network: "none",
      createSandbox: async () => ({
        writeFiles: async () => undefined,
        runCommand: async ({ args }) => {
          commands.push(args?.at(-1) ?? "");
          return { exitCode: 0, durationMs: 3, output: async () => "{}" };
        },
        downloadFile,
        stop,
      }),
    });
    const result = await runner.execute({
      command: "optimizer-analyze",
      workspacePath: workspace,
      timeoutMs: 30_000,
      readOnly: true,
    });
    expect(result.exitCode).toBe(0);
    expect(commands.some((command) => command.includes("chmod -R a-w /workspace")))
      .toBe(true);
    expect(downloadFile).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
});

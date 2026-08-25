import { EventEmitter } from "node:events";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: spawnMock,
}));

import { DockerTrustedRunner } from "./docker.js";

beforeEach(() => {
  spawnMock.mockReset();
});

function childProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("DockerTrustedRunner", () => {
  it("applies containment flags and mounts a configured workspace volume", async () => {
    const child = childProcess();
    spawnMock.mockReturnValueOnce(child);
    const runner = new DockerTrustedRunner({
      image: "software-oath-runner@sha256:abc",
      workspaceRoot: process.cwd(),
      workspaceVolume: "software-oath-workspaces",
      environment: { INFRACOST_API_KEY: "cost-secret" },
    });

    const execution = runner.execute({
      command: "npm test",
      workspacePath: join(process.cwd(), "src"),
      timeoutMs: 1_000,
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    child.emit("close", 0);
    await expect(execution).resolves.toMatchObject({ exitCode: 0 });

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining([
      "--network", "none",
      "--pids-limit", "256",
      "--security-opt", "no-new-privileges",
      "--cap-drop", "ALL",
      "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=1g",
      "--env", "HOME=/tmp",
      "--env", "npm_config_cache=/tmp/npm-cache",
      "--env", "INFRACOST_API_KEY",
      "--pull", "never",
      "--mount", "type=volume,src=software-oath-workspaces,dst=/runner-workspaces",
      "-w", "/runner-workspaces/src",
      "software-oath-quota", "npm test",
    ]));
    expect(args.join(" ")).toContain("Workspace disk quota exceeded");
    expect(args).not.toContain("cost-secret");
    expect(spawnMock.mock.calls[0][2]?.env).toMatchObject({
      INFRACOST_API_KEY: "cost-secret",
    });
  });

  it("rejects a workspace outside the configured shared root", async () => {
    const runner = new DockerTrustedRunner({
      image: "software-oath-runner:local",
      workspaceRoot: process.cwd(),
      workspaceVolume: "software-oath-workspaces",
    });
    await expect(runner.execute({
      command: "true",
      workspacePath: "/",
      timeoutMs: 1_000,
    })).rejects.toThrow("must be a child");
  });

  it("mounts analyzer workspaces read-only", async () => {
    const child = childProcess();
    spawnMock.mockReturnValueOnce(child);
    const runner = new DockerTrustedRunner({ image: "software-oath-runner:local" });
    const execution = runner.execute({
      command: "optimizer-analyze",
      workspacePath: process.cwd(),
      timeoutMs: 1_000,
      readOnly: true,
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    child.emit("close", 0);
    await execution;
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain(`type=bind,src=${process.cwd()},dst=/workspace,readonly`);
  });

  it("rejects a workspace symlink that escapes the shared root", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-runner-root-"));
    const escape = join(root, "escape");
    await symlink("/", escape);
    const runner = new DockerTrustedRunner({
      image: "software-oath-runner:local",
      workspaceRoot: root,
      workspaceVolume: "software-oath-workspaces",
    });
    try {
      await expect(runner.execute({
        command: "true",
        workspacePath: escape,
        timeoutMs: 1_000,
      })).rejects.toThrow("must be a child");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid environment names", () => {
    expect(() => new DockerTrustedRunner({
      image: "software-oath-runner:local",
      environment: { "BAD=VALUE": "secret" },
    })).toThrow("environment names");
  });

  it("requires a non-empty image", () => {
    expect(() => new DockerTrustedRunner({ image: " " })).toThrow(
      "trusted runner image is required",
    );
  });

  it("rejects invalid workspace disk limits before execution", async () => {
    const runner = new DockerTrustedRunner({
      image: "software-oath-runner:local",
      workspaceDiskLimitKb: 0,
    });
    await expect(runner.execute({
      command: "true",
      workspacePath: process.cwd(),
      timeoutMs: 1_000,
    })).rejects.toThrow("positive integer");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

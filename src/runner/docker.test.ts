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

import { DockerTrustedRunner } from "./docker";

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
      "--pull", "never",
      "--mount", "type=volume,src=software-oath-workspaces,dst=/runner-workspaces",
      "-w", "/runner-workspaces/src",
    ]));
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

  it("requires a non-empty image", () => {
    expect(() => new DockerTrustedRunner({ image: " " })).toThrow(
      "trusted runner image is required",
    );
  });
});

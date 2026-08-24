import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

import type {
  CommandRequest,
  CommandResult,
  TrustedRunner,
} from "./types";
import { redactSensitiveOutput } from "./redact";

const execFileAsync = promisify(execFile);

export interface DockerRunnerOptions {
  image: string;
  network?: "none" | "bridge";
  memory?: string;
  cpus?: number;
  pidsLimit?: number;
  outputLimit?: number;
  tmpfsSize?: string;
  workspaceRoot?: string;
  workspaceVolume?: string;
}

export class DockerTrustedRunner implements TrustedRunner {
  readonly name: string;

  constructor(private readonly options: DockerRunnerOptions) {
    if (!options.image.trim()) throw new Error("A trusted runner image is required.");
    this.name = `docker-ephemeral:${options.image}`;
  }

  async identity(): Promise<string> {
    if (this.options.image.includes("@sha256:")) return this.options.image;
    const { stdout } = await execFileAsync(
      "docker",
      ["image", "inspect", "--format={{.Id}}", this.options.image],
      { timeout: 10_000 },
    );
    const digest = stdout.trim();
    if (!digest.startsWith("sha256:")) {
      throw new Error("The trusted runner image did not resolve to a sha256 digest.");
    }
    return `${this.options.image}@${digest}`;
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    const startedAt = Date.now();
    const workspace = resolve(request.workspacePath);
    const containerName = `software-oath-runner-${randomUUID()}`;
    const workspaceArgs = await this.workspaceArguments(workspace);
    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--init",
      "--pull",
      "never",
      "--network",
      this.options.network ?? "none",
      "--memory",
      this.options.memory ?? "4g",
      "--cpus",
      String(this.options.cpus ?? 2),
      "--pids-limit",
      String(this.options.pidsLimit ?? 256),
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "--read-only",
      "--tmpfs",
      `/tmp:rw,noexec,nosuid,nodev,size=${this.options.tmpfsSize ?? "1g"}`,
      "--env",
      "HOME=/tmp",
      "--env",
      "npm_config_cache=/tmp/npm-cache",
      ...workspaceArgs.mount,
      "-w",
      workspaceArgs.containerPath,
      this.options.image,
      "sh",
      "-lc",
      request.command,
    ];

    return await new Promise((resolveResult) => {
      const child = spawn("docker", args, {
        cwd: workspace,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let timedOut = false;
      const append = (chunk: Buffer) => {
        output += chunk.toString();
        const limit = this.options.outputLimit ?? 12_000;
        if (output.length > limit) {
          output = `[output truncated]\n${output.slice(-limit)}`;
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        const cleanup = spawn("docker", ["rm", "--force", containerName], {
          stdio: "ignore",
        });
        cleanup.unref();
      }, request.timeoutMs);

      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolveResult({
          exitCode: null,
          output: redactSensitiveOutput(`${output}\n${error.message}`.trim()),
          durationMs: Date.now() - startedAt,
        });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolveResult({
          exitCode,
          output: redactSensitiveOutput(
            `${output}${timedOut ? `\nTimed out after ${request.timeoutMs}ms.` : ""}`.trim(),
          ),
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }

  private async workspaceArguments(workspace: string): Promise<{
    mount: string[];
    containerPath: string;
  }> {
    if (!this.options.workspaceVolume) {
      return {
        mount: ["--mount", `type=bind,src=${workspace},dst=/workspace`],
        containerPath: "/workspace",
      };
    }
    if (!this.options.workspaceRoot) {
      throw new Error("workspaceRoot is required with workspaceVolume.");
    }
    const root = await realpath(resolve(this.options.workspaceRoot));
    const actualWorkspace = await realpath(workspace);
    const child = relative(root, actualWorkspace).replaceAll("\\", "/");
    if (!child || child === ".." || child.startsWith("../")) {
      throw new Error("Runner workspace must be a child of the configured workspace root.");
    }
    return {
      mount: [
        "--mount",
        `type=volume,src=${this.options.workspaceVolume},dst=/runner-workspaces`,
      ],
      containerPath: `/runner-workspaces/${child}`,
    };
  }
}

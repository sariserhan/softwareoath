import { spawn } from "node:child_process";
import { resolve } from "node:path";

import type {
  CommandRequest,
  CommandResult,
  TrustedRunner,
} from "./types";

export interface DockerRunnerOptions {
  image: string;
  network?: "none" | "bridge";
  memory?: string;
  cpus?: number;
}

export class DockerTrustedRunner implements TrustedRunner {
  readonly name = "docker-ephemeral";

  constructor(private readonly options: DockerRunnerOptions) {}

  async execute(request: CommandRequest): Promise<CommandResult> {
    const startedAt = Date.now();
    const workspace = resolve(request.workspacePath);
    const args = [
      "run",
      "--rm",
      "--init",
      "--network",
      this.options.network ?? "none",
      "--memory",
      this.options.memory ?? "4g",
      "--cpus",
      String(this.options.cpus ?? 2),
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "-v",
      `${workspace}:/workspace`,
      "-w",
      "/workspace",
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
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolveResult({
          exitCode: null,
          output: `${output}\n${error.message}`.trim(),
          durationMs: Date.now() - startedAt,
        });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolveResult({
          exitCode,
          output: `${output}${timedOut ? `\nTimed out after ${request.timeoutMs}ms.` : ""}`.trim(),
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}

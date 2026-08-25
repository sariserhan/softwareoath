import { spawn } from "node:child_process";

import type {
  CommandRequest,
  CommandResult,
  TrustedRunner,
} from "./types.js";
import { redactSensitiveOutput } from "./redact.js";

const OUTPUT_LIMIT = 12_000;

function bounded(value: string): string {
  value = redactSensitiveOutput(value);
  return value.length <= OUTPUT_LIMIT
    ? value
    : `[output truncated]\n${value.slice(-OUTPUT_LIMIT)}`;
}

export class LocalTrustedRunner implements TrustedRunner {
  readonly name = "local-trusted";

  async execute(request: CommandRequest): Promise<CommandResult> {
    const startedAt = Date.now();

    return await new Promise((resolve) => {
      const child = spawn(request.command, {
        cwd: request.workspacePath,
        env: process.env,
        shell: true,
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
        resolve({
          exitCode: null,
          output: bounded(`${output}\n${error.message}`.trim()),
          durationMs: Date.now() - startedAt,
        });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          output: bounded(
            `${output}${timedOut ? `\nTimed out after ${request.timeoutMs}ms.` : ""}`.trim(),
          ),
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}

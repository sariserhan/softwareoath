import { spawn } from "node:child_process";

import type { RepairAgent } from "./types";

const OUTPUT_LIMIT = 20_000;

export class CodexRepairAgent implements RepairAgent {
  readonly name = "codex-cli";

  async repair({
    workspacePath,
    prompt,
  }: {
    workspacePath: string;
    prompt: string;
  }): Promise<{ summary: string; output: string }> {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "codex",
        [
          "exec",
          "--ephemeral",
          "--ignore-user-config",
          "--sandbox",
          "workspace-write",
          "--cd",
          workspacePath,
          "-",
        ],
        { cwd: workspacePath, stdio: ["pipe", "pipe", "pipe"] },
      );
      let combined = "";

      child.stdout.on("data", (chunk: Buffer) => {
        combined += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        combined += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Codex repair process failed with exit code ${code}.\n${combined.slice(-OUTPUT_LIMIT)}`,
            ),
          );
          return;
        }
        resolve(combined.slice(-OUTPUT_LIMIT));
      });
      child.stdin.end(prompt);
    });

    return {
      summary: "Codex completed the bounded repair attempt.",
      output,
    };
  }
}

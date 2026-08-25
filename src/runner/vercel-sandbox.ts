import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Sandbox, type NetworkPolicy } from "@vercel/sandbox";
import { create as createArchive, extract as extractArchive, list as listArchive } from "tar";

import { redactSensitiveOutput } from "./redact.js";
import type { CommandRequest, CommandResult, TrustedRunner } from "./types.js";
import { assertSafeRepositoryWorkspace } from "./workspace.js";

interface SandboxCommandResult {
  exitCode: number;
  durationMs?: number;
  output(stream?: "stdout" | "stderr" | "both"): Promise<string>;
}

interface SandboxSession {
  writeFiles(files: Array<{ path: string; content: Uint8Array }>): Promise<void>;
  downloadFile(
    source: { path: string },
    destination: { path: string },
  ): Promise<string | null>;
  runCommand(input: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<SandboxCommandResult>;
  stop(): Promise<unknown>;
}

export interface VercelSandboxRunnerOptions {
  image: string;
  network: "none" | "bridge";
  environment?: Record<string, string>;
  networkPolicy?: NetworkPolicy;
  outputLimit?: number;
  createSandbox?: () => Promise<SandboxSession>;
}

function assertArchivePaths(entries: string[]): void {
  for (const raw of entries) {
    const path = raw.trim().replace(/^\.\//, "");
    if (!path) continue;
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Sandbox returned an unsafe archive path: ${raw}`);
    }
  }
}

export class VercelSandboxTrustedRunner implements TrustedRunner {
  readonly name: string;

  constructor(private readonly options: VercelSandboxRunnerOptions) {
    if (!options.image.trim()) throw new Error("A Vercel Sandbox image is required.");
    if (process.env.VERCEL === "1" && !options.image.includes("@sha256:")) {
      throw new Error("Production Vercel Sandbox images must be pinned by sha256 digest.");
    }
    this.name = `vercel-sandbox:${options.network}:${options.image}`;
  }

  async identity(): Promise<string> {
    return this.name;
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    const startedAt = Date.now();
    const workspace = resolve(request.workspacePath);
    await assertSafeRepositoryWorkspace(workspace);
    const transferRoot = await mkdtemp(join(tmpdir(), "software-oath-sandbox-"));
    const inputArchive = join(transferRoot, "input.tgz");
    const outputArchive = join(transferRoot, "output.tgz");
    const extracted = join(transferRoot, "extracted");
    const backup = join(dirname(workspace), `.software-oath-backup-${Date.now()}`);
    let sandbox: SandboxSession | undefined;
    try {
      await createArchive({
        cwd: workspace,
        file: inputArchive,
        gzip: true,
        portable: true,
      }, ["."]);
      const archive = await readFile(inputArchive);
      sandbox = await this.createSandbox();
      await sandbox.writeFiles([{ path: "/tmp/software-oath-input.tgz", content: archive }]);
      const setup = await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-lc",
          "find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && " +
            "tar -xzf /tmp/software-oath-input.tgz -C /workspace" +
            (request.readOnly ? " && chmod -R a-w /workspace" : ""),
        ],
        timeoutMs: 60_000,
      });
      if (setup.exitCode !== 0) throw new Error(`Sandbox workspace setup failed: ${await setup.output("both")}`);

      const result = await sandbox.runCommand({
        cmd: "sh",
        args: ["-lc", request.command],
        cwd: "/workspace",
        env: this.options.environment,
        timeoutMs: request.timeoutMs,
      });
      const output = await result.output("both");

      if (request.readOnly) {
        const limit = this.options.outputLimit ?? 262_144;
        const bounded = output.length > limit ? `[output truncated]\n${output.slice(-limit)}` : output;
        return {
          exitCode: result.exitCode,
          output: redactSensitiveOutput(bounded),
          durationMs: result.durationMs ?? Date.now() - startedAt,
        };
      }

      const pack = await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-lc",
          "tar -czf /tmp/software-oath-output.tgz -C /workspace .",
        ],
        timeoutMs: 60_000,
      });
      if (pack.exitCode !== 0) throw new Error(`Sandbox workspace export failed: ${await pack.output("both")}`);
      if (!(await sandbox.downloadFile({ path: "/tmp/software-oath-output.tgz" }, { path: outputArchive }))) {
        throw new Error("Sandbox workspace export was not returned.");
      }

      const entries: string[] = [];
      await listArchive({
        file: outputArchive,
        strict: true,
        onReadEntry: (entry) => {
          if (entry.type === "Link") {
            throw new Error(`Sandbox returned an unsupported hard link: ${entry.path}`);
          }
          entries.push(entry.path);
        },
      });
      assertArchivePaths(entries);
      await mkdir(extracted, { recursive: true });
      await extractArchive({
        cwd: extracted,
        file: outputArchive,
        noChmod: true,
        preserveOwner: false,
        preservePaths: false,
        strict: true,
      });
      await rename(workspace, backup);
      try {
        await rename(extracted, workspace);
        await assertSafeRepositoryWorkspace(workspace);
        await rm(backup, { recursive: true, force: true });
      } catch (error) {
        await rename(backup, workspace).catch(() => undefined);
        throw error;
      }

      const limit = this.options.outputLimit ?? 262_144;
      const bounded = output.length > limit ? `[output truncated]\n${output.slice(-limit)}` : output;
      return {
        exitCode: result.exitCode,
        output: redactSensitiveOutput(bounded),
        durationMs: result.durationMs ?? Date.now() - startedAt,
      };
    } finally {
      await sandbox?.stop().catch(() => undefined);
      await rm(transferRoot, { recursive: true, force: true });
    }
  }

  private async createSandbox(): Promise<SandboxSession> {
    if (this.options.createSandbox) return this.options.createSandbox();
    return Sandbox.create({
      image: this.options.image,
      timeout: 11 * 60_000,
      resources: { vcpus: 2 },
      networkPolicy: this.options.networkPolicy ??
        (this.options.network === "bridge" ? "allow-all" : "deny-all"),
      persistent: false,
    });
  }
}

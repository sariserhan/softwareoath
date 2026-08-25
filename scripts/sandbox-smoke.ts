import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { VercelSandboxTrustedRunner } from "../src/runner/vercel-sandbox.js";

const execFileAsync = promisify(execFile);
const image = process.env.SOFTWARE_OATH_SANDBOX_IMAGE?.trim();
if (!image) throw new Error("SOFTWARE_OATH_SANDBOX_IMAGE is required.");

const workspace = await mkdtemp(join(tmpdir(), "software-oath-sandbox-smoke-"));
try {
  await execFileAsync("git", ["init", "-q"], { cwd: workspace });
  await writeFile(join(workspace, "sandbox-input.txt"), "sandbox-ready\n");
  await execFileAsync("git", ["add", "sandbox-input.txt"], { cwd: workspace });

  const runner = new VercelSandboxTrustedRunner({ image, network: "none" });
  const result = await runner.execute({
    command:
      "test \"$(cat sandbox-input.txt)\" = sandbox-ready && printf 'sandbox-roundtrip\\n' > sandbox-output.txt",
    workspacePath: workspace,
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0) throw new Error(result.output);
  console.log("Vercel Sandbox image boot and workspace round-trip succeeded.");
} finally {
  await rm(workspace, { recursive: true, force: true });
}

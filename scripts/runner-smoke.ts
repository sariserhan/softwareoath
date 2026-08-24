import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DockerTrustedRunner } from "../src/runner/docker";

const image = process.argv[2] ?? process.env.SOFTWARE_OATH_RUNNER_IMAGE;
if (!image) {
  throw new Error("Pass a runner image or set SOFTWARE_OATH_RUNNER_IMAGE.");
}

const workspace = await mkdtemp(join(tmpdir(), "software-oath-runner-smoke-"));
await writeFile(join(workspace, "fixture.txt"), "ok\n", "utf8");
await chmod(workspace, 0o755);
const runner = new DockerTrustedRunner({
  image,
  outputLimit: 256,
  workspaceDiskLimitKb: 64,
});

async function expectResult(options: {
  name: string;
  command: string;
  timeoutMs?: number;
  valid: (result: { exitCode: number | null; output: string }) => boolean;
}) {
  const result = await runner.execute({
    command: options.command,
    workspacePath: workspace,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
  if (!options.valid(result)) {
    throw new Error(
      `${options.name} failed: exit=${result.exitCode}, output=${result.output}`,
    );
  }
  process.stdout.write(`${options.name}: passed\n`);
}

try {
  await expectResult({
    name: "workspace disk exhaustion",
    command:
      "dd if=/dev/zero of=quota.bin bs=1024 count=128 2>/dev/null || { echo quota-blocked; exit 73; }",
    valid: ({ exitCode, output }) =>
      exitCode === 73 && output.includes("quota-blocked"),
  });
  await expectResult({
    name: "workspace mount",
    command: "cat fixture.txt",
    valid: ({ exitCode, output }) => exitCode === 0 && output === "ok",
  });
  await expectResult({
    name: "credential isolation",
    command:
      "node -e \"process.stdout.write(String(process.env.SOFTWARE_OATH_MASTER_KEY))\"",
    valid: ({ exitCode, output }) => exitCode === 0 && output === "undefined",
  });
  await expectResult({
    name: "read-only root",
    command: "touch /runner-root-write",
    valid: ({ exitCode }) => exitCode !== 0,
  });
  await expectResult({
    name: "network denied",
    command:
      "node -e \"fetch('https://example.com').then(()=>process.exit(1)).catch(()=>process.stdout.write('blocked'))\"",
    valid: ({ exitCode, output }) => exitCode === 0 && output === "blocked",
  });
  await expectResult({
    name: "bounded output",
    command: "node -e \"process.stdout.write('x'.repeat(5000))\"",
    valid: ({ exitCode, output }) =>
      exitCode === 0 &&
      output.startsWith("[output truncated]") &&
      output.length < 300,
  });
  await expectResult({
    name: "process limit",
    command:
      "node -e \"const{spawn}=require('child_process');let blocked=false;for(let i=0;i<400;i++){const child=spawn('sleep',['1']);child.on('error',()=>{blocked=true})}setTimeout(()=>{process.stdout.write(blocked?'blocked':'unbounded');process.exit(blocked?0:1)},100)\"",
    valid: ({ exitCode, output }) => exitCode === 0 && output === "blocked",
  });
  await expectResult({
    name: "timeout cleanup",
    command: "node -e \"setInterval(()=>{},1000)\"",
    timeoutMs: 250,
    valid: ({ exitCode, output }) =>
      exitCode !== 0 && output.includes("Timed out after 250ms."),
  });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

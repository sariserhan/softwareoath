import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { runRepair } from "./run";
import type { RepairAgent } from "./types";

const execFileAsync = promisify(execFile);

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "software-oath-repair-test-"));
  await execFileAsync("git", ["init", "-q"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "test@softwareoath.local"], {
    cwd: directory,
  });
  await execFileAsync("git", ["config", "user.name", "Software Oath Test"], {
    cwd: directory,
  });
  await mkdir(join(directory, "src"));
  await writeFile(
    join(directory, "package.json"),
    '{"name":"fixture","scripts":{"test":"node -e \\"process.exit(0)\\""}}\n',
  );
  await writeFile(join(directory, "src", "index.js"), "export const ok = true;\n");
  await writeFile(
    join(directory, "software-oath.yml"),
    `version: 1
application:
  name: Fixture
  repository: fixture/app
  defaultBranch: main
approval:
  requireHumanFor: []
  allowAutomaticMerge: false
rules:
  - id: app.tests
    title: Tests pass
    description: Tests must remain green.
    severity: high
    evidence:
      - kind: test
        command: npm test
        required: true
`,
  );
  await execFileAsync("git", ["add", "."], { cwd: directory });
  await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: directory });
  return directory;
}

function agent(
  callback: (workspacePath: string) => Promise<void>,
): RepairAgent {
  return {
    name: "fixture-agent",
    async repair({ workspacePath }) {
      await callback(workspacePath);
      return { summary: "Fixture repair complete.", output: "done" };
    },
  };
}

describe("runRepair", () => {
  it("exports a verified in-scope patch from a disposable worktree", async () => {
    const repositoryPath = await fixture();
    const receipt = await runRepair({
      repositoryPath,
      agent: agent(async (workspacePath) => {
        await writeFile(
          join(workspacePath, "package-lock.json"),
          '{"name":"fixture","lockfileVersion":3,"packages":{}}\n',
        );
      }),
      now: () => new Date("2026-07-30T16:00:00Z"),
    });

    expect(receipt.decision).toBe("ready");
    expect(receipt.changes.files).toEqual(["package-lock.json"]);
    expect(await readFile(receipt.changes.patchPath, "utf8")).toContain(
      "package-lock.json",
    );
    await expect(access(join(repositoryPath, "package-lock.json"))).rejects.toThrow();
  });

  it("blocks changes outside the finding repair scope", async () => {
    const repositoryPath = await fixture();
    const receipt = await runRepair({
      repositoryPath,
      agent: agent(async (workspacePath) => {
        await writeFile(join(workspacePath, "README.md"), "unexpected\n");
      }),
    });

    expect(receipt.decision).toBe("blocked");
    expect(receipt.changes.withinAllowedScope).toBe(false);
  });
});

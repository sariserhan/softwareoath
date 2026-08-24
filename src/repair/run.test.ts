import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  prepareExternalRepair,
  verifyExternalRepair,
} from "./external";
import { applyRepair, formatRepairReview } from "./receipt";
import { isProtectedRepairPath, runRepair } from "./run";
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

describe("repair scope", () => {
  it("always protects oath, workflow, ownership, and internal configuration", () => {
    expect([
      "software-oath.yml",
      ".github/workflows/ci.yml",
      ".github/CODEOWNERS",
      "CODEOWNERS",
      ".software-oath/config.json",
    ].every(isProtectedRepairPath)).toBe(true);
    expect(isProtectedRepairPath("package-lock.json")).toBe(false);
  });
});

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
    expect(receipt.proof.selectedFindingResolved).toBe(true);
    expect(receipt.proof.blockingNewFindings).toEqual([]);
    expect(receipt.changes.files).toEqual(["package-lock.json"]);
    expect(await readFile(receipt.changes.patchPath, "utf8")).toContain(
      "package-lock.json",
    );
    await expect(access(join(repositoryPath, "package-lock.json"))).rejects.toThrow();

    const review = await formatRepairReview({
      repositoryPath,
      repairId: receipt.id,
    });
    expect(review).toContain("# Software Oath repair review");
    expect(review).toContain("package-lock.json");

    const application = await applyRepair({
      repositoryPath,
      repairId: receipt.id,
      now: () => new Date("2026-07-30T16:01:00Z"),
    });
    expect(application.decision).toBe("ready");
    expect(application.branch).toBe("software-oath/repair-20260730160000");
    await expect(access(join(repositoryPath, "package-lock.json"))).resolves.toBe(
      undefined,
    );
  });

  it("rejects a newly created symlink that escapes through an allowed path", async () => {
    const repositoryPath = await fixture();
    const outside = join(repositoryPath, "..", "outside-lock.json");
    await writeFile(outside, "{}\n");

    await expect(runRepair({
      repositoryPath,
      agent: agent(async (workspacePath) => {
        await symlink(outside, join(workspacePath, "package-lock.json"));
      }),
    })).rejects.toThrow("escapes the repository workspace");
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

  it("preserves the full path for modified tracked files", async () => {
    const repositoryPath = await fixture();
    const receipt = await runRepair({
      repositoryPath,
      agent: agent(async (workspacePath) => {
        await writeFile(
          join(workspacePath, "package.json"),
          '{"name":"fixture","description":"updated","scripts":{"test":"node -e \\"process.exit(0)\\""}}\n',
        );
      }),
    });

    expect(receipt.changes.files).toEqual(["package.json"]);
    expect(receipt.changes.withinAllowedScope).toBe(true);
    expect(receipt.proof.selectedFindingResolved).toBe(false);
    expect(receipt.decision).toBe("blocked");
  });

  it("aborts when the repository has no software oath", async () => {
    const repositoryPath = await fixture();
    await execFileAsync("git", ["rm", "software-oath.yml"], { cwd: repositoryPath });
    await execFileAsync("git", ["commit", "-qm", "Remove oath"], {
      cwd: repositoryPath,
    });

    await expect(
      runRepair({
        repositoryPath,
        agent: agent(async () => undefined),
      }),
    ).rejects.toThrow("software-oath.yml");
  });

  it("blocks an empty repair patch", async () => {
    const repositoryPath = await fixture();
    const receipt = await runRepair({
      repositoryPath,
      agent: agent(async () => undefined),
    });

    expect(receipt.changes.files).toEqual([]);
    expect(await readFile(receipt.changes.patchPath, "utf8")).toBe("");
    expect(receipt.decision).toBe("blocked");
  });

  it("blocks a repair when isolated oath verification times out", async () => {
    const repositoryPath = await fixture();
    const receipt = await runRepair({
      repositoryPath,
      agent: agent(async (workspacePath) => {
        await writeFile(
          join(workspacePath, "package-lock.json"),
          `{"name":"fixture","lockfileVersion":3,"packages":{}}\n`,
        );
      }),
      runner: {
        name: "fixture-timeout-runner",
        async execute(request) {
          return {
            exitCode: null,
            output: `Timed out after ${request.timeoutMs}ms.`,
            durationMs: request.timeoutMs,
          };
        },
      },
    });

    expect(receipt.verification.report.decision).toBe("blocked");
    expect(receipt.verification.run.evidence[0].summary).toContain("Timed out");
    expect(receipt.decision).toBe("blocked");
  });

  it("prepares and verifies a repair performed by an external CI agent", async () => {
    const repositoryPath = await fixture();
    const outputDirectory = await mkdtemp(
      join(tmpdir(), "software-oath-external-"),
    );
    const prepared = await prepareExternalRepair({
      repositoryPath,
      outputDirectory,
      now: () => new Date("2026-07-30T17:00:00Z"),
    });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    await writeFile(
      join(repositoryPath, "package-lock.json"),
      '{"name":"fixture","lockfileVersion":3,"packages":{}}\n',
    );
    const receipt = await verifyExternalRepair({
      repositoryPath,
      contextPath: prepared.contextPath,
      outputDirectory: join(outputDirectory, "artifact"),
      now: () => new Date("2026-07-30T17:01:00Z"),
    });

    expect(receipt.decision).toBe("ready");
    expect(receipt.proof.selectedFindingResolved).toBe(true);
    expect(receipt.agent.name).toBe("openai/codex-action");
    expect(receipt.changes.patchSha256).toHaveLength(64);
  });
});

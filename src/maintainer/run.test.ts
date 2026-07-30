import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runMaintenance } from "./run";

async function fixture(command: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "software-oath-"));
  await mkdir(join(directory, "tests"));
  await writeFile(join(directory, "tests", "promise.test.ts"), "");
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
  - id: app.healthy
    title: Application remains healthy
    description: The declared health check must pass.
    severity: high
    evidence:
      - kind: command
        command: ${command}
        required: true
`,
  );
  return directory;
}

describe("runMaintenance", () => {
  it("produces a ready receipt when executable evidence passes", async () => {
    const repositoryPath = await fixture("node --version");
    const receipt = await runMaintenance({
      repositoryPath,
      writeReceipt: true,
      now: () => new Date("2026-07-30T12:00:00Z"),
    });

    expect(receipt.report.decision).toBe("ready");
    expect(receipt.report.summary.passed).toBe(1);
    const stored = JSON.parse(
      await readFile(
        join(repositoryPath, ".softwareoath/runs/RUN-20260730120000.json"),
        "utf8",
      ),
    ) as { report: { decision: string } };
    expect(stored.report.decision).toBe("ready");
  });

  it("blocks a failed executable check", async () => {
    const repositoryPath = await fixture('node -e "process.exit(7)"');
    const receipt = await runMaintenance({
      repositoryPath,
      writeReceipt: false,
    });

    expect(receipt.report.decision).toBe("blocked");
    expect(receipt.run.evidence[0].summary).toContain("exit code 7");
  });

  it("does not claim an unexecuted test passed", async () => {
    const repositoryPath = await fixture("node --version");
    await writeFile(
      join(repositoryPath, "software-oath.yml"),
      `version: 1
application:
  name: Fixture
  repository: fixture/app
  defaultBranch: main
approval:
  requireHumanFor: []
  allowAutomaticMerge: false
rules:
  - id: app.test
    title: Tests remain healthy
    description: The test must actually execute.
    severity: high
    evidence:
      - kind: test
        path: tests/promise.test.ts
        required: true
`,
    );

    const receipt = await runMaintenance({
      repositoryPath,
      writeReceipt: false,
    });

    expect(receipt.report.decision).toBe("review_required");
    expect(receipt.run.evidence[0].summary).toContain("no executable command");
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { inspectRepository } from "./inspect";

const execFileAsync = promisify(execFile);

async function repository(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "software-oath-inspect-"));
  await execFileAsync("git", ["init", "-q"], { cwd: directory });
  for (const [path, source] of Object.entries(files)) {
    await writeFile(join(directory, path), source);
  }
  await execFileAsync("git", ["add", "."], { cwd: directory });
  return directory;
}

describe("inspectRepository", () => {
  it("detects tracked secret files and scopes remediation", async () => {
    const repositoryPath = await repository({
      ".env": "TOKEN=example",
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const report = await inspectRepository({ repositoryPath });

    expect(report.summary.critical).toBe(1);
    expect(report.findings[0].detector).toBe("tracked-secret-file");
    expect(report.findings[0].repair.allowedPaths).toEqual([
      ".env",
      ".gitignore",
    ]);
  });

  it("detects a missing dependency lockfile", async () => {
    const repositoryPath = await repository({
      "package.json": '{"dependencies":{"react":"19.0.0"}}',
    });
    const report = await inspectRepository({ repositoryPath });

    expect(report.summary.high).toBe(1);
    expect(report.findings[0].repair.automaticCandidate).toBe(true);
  });

  it("returns a clean report when no supported signals are present", async () => {
    const repositoryPath = await repository({
      "app.ts": "export const healthy = true;\n",
    });
    const report = await inspectRepository({ repositoryPath });

    expect(report.summary.total).toBe(0);
  });

  it("turns any failed oath command into a bounded finding", async () => {
    const repositoryPath = await repository({
      "app.go": "package app\n",
      "software-oath.yml": `version: 1
application:
  name: Generic application
  repository: fixture/generic
  defaultBranch: main
approval:
  requireHumanFor: []
  allowAutomaticMerge: false
rules:
  - id: application.behavior
    title: Application behavior remains valid
    description: The repository's own validation must pass.
    severity: high
    repair:
      allowedPaths: [app.go]
      automaticCandidate: true
    evidence:
      - kind: command
        command: node -e "process.exit(1)"
        required: true
`,
    });
    const report = await inspectRepository({ repositoryPath });
    const finding = report.findings.find(
      ({ detector }) => detector === "oath-check-failure",
    );

    expect(finding).toMatchObject({
      severity: "high",
      repair: {
        allowedPaths: ["app.go"],
        automaticCandidate: true,
      },
    });
  });
});

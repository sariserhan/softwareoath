import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { inspectRepository } from "./inspect.js";

const execFileAsync = promisify(execFile);

async function repository(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "software-oath-inspect-"));
  await execFileAsync("git", ["init", "-q"], { cwd: directory });
  for (const [path, source] of Object.entries(files)) {
    const fullPath = join(directory, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, source);
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
    const commands: string[] = [];
    const report = await inspectRepository({
      repositoryPath,
      runner: {
        name: "fixture-isolated",
        async execute(request) {
          commands.push(request.command);
          return { exitCode: 1, output: "failed", durationMs: 1 };
        },
      },
    });
    const finding = report.findings.find(
      ({ detector }) => detector === "oath-check-failure",
    );

    expect(commands).toEqual([`node -e "process.exit(1)"`]);
    expect(finding).toMatchObject({
      severity: "high",
      repair: {
        allowedPaths: ["app.go"],
        automaticCandidate: true,
      },
    });
  });

  it("detects unpinned GitHub Actions and Dockerfile base images", async () => {
    const repositoryPath = await repository({
      "Dockerfile": "FROM node:latest\nUSER node\n",
      ".github/workflows/ci.yml": "name: CI\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n",
    });
    const report = await inspectRepository({ repositoryPath });

    const actionFinding = report.findings.find(({ detector }) => detector === "unpinned-github-action");
    const dockerFinding = report.findings.find(({ detector }) => detector === "unpinned-docker-base-image");

    expect(actionFinding).toBeDefined();
    expect(actionFinding?.severity).toBe("low");
    expect(dockerFinding).toBeDefined();
    expect(dockerFinding?.severity).toBe("low");
  });
});

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

  it("reports maintenance markers with exact locations", async () => {
    const repositoryPath = await repository({
      "app.ts": "// TODO: remove the compatibility branch\nexport {};\n",
    });
    const report = await inspectRepository({ repositoryPath });

    expect(report.summary.low).toBe(1);
    expect(report.findings[0].evidence).toMatchObject({
      path: "app.ts",
      line: 1,
    });
  });

  it("returns a clean report when no supported signals are present", async () => {
    const repositoryPath = await repository({
      "app.ts": "export const healthy = true;\n",
    });
    const report = await inspectRepository({ repositoryPath });

    expect(report.summary.total).toBe(0);
  });
});

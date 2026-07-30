import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { parseOath } from "../domain/oath";
import { initializeRepository } from "./init";

const execFileAsync = promisify(execFile);

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "software-oath-init-"));
  await execFileAsync("git", ["init", "-q"], { cwd: directory });
  return directory;
}

describe("initializeRepository", () => {
  it("discovers repository-owned JavaScript commands conservatively", async () => {
    const repositoryPath = await repository();
    await writeFile(
      join(repositoryPath, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: {
          test: "vitest run",
          build: "tsc",
          lint: "eslint .",
        },
      }),
    );

    const result = await initializeRepository({ repositoryPath });
    const oath = parseOath(
      await readFile(join(repositoryPath, "software-oath.yml"), "utf8"),
    );

    expect(result.discoveredChecks.map(({ command }) => command)).toEqual([
      "npm test",
      "npm run build",
      "npm run lint",
    ]);
    expect(oath.rules).toHaveLength(3);
    expect(oath.rules.every((rule) => rule.repair === undefined)).toBe(true);
  });

  it("falls back to human review rather than inventing a command", async () => {
    const repositoryPath = await repository();
    const result = await initializeRepository({
      repositoryPath,
      dryRun: true,
    });

    expect(result.created).toBe(false);
    expect(parseOath(result.source).rules[0].evidence[0].kind).toBe("review");
  });

  it("does not overwrite an existing constitution by default", async () => {
    const repositoryPath = await repository();
    await writeFile(join(repositoryPath, "software-oath.yml"), "existing");

    await expect(initializeRepository({ repositoryPath })).rejects.toThrow(
      "already exists",
    );
  });
});

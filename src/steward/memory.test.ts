import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { scanRepositoryMemory } from "./memory";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository stewardship memory", () => {
  it("updates a commit-keyed structural memory on every scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-memory-"));
    roots.push(root);
    await execFileAsync("git", ["init", "-q", "-b", "main", root]);
    await writeFile(join(root, "package.json"), '{"scripts":{"test":"node --test"}}\n');
    await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
    await writeFile(join(root, "app.test.ts"), "export {};\n");
    await writeFile(
      join(root, "software-oath.yml"),
      `version: 1
application:
  name: Memory fixture
  repository: owner/memory-fixture
  defaultBranch: main
approval:
  requireHumanFor: []
  allowAutomaticMerge: false
rules:
  - id: repository.health
    title: Repository stays healthy
    description: The fixture check passes.
    severity: high
    evidence:
      - kind: command
        command: node -e "process.exit(0)"
        required: true
`,
    );
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "fixture"], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.com",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.com",
      },
    });
    const memoryPath = join(root, ".software-oath", "memory.json");
    const first = await scanRepositoryMemory({ repositoryPath: root, memoryPath });
    const second = await scanRepositoryMemory({ repositoryPath: root, memoryPath });

    expect(second).toMatchObject({
      repository: "owner/memory-fixture",
      commit: first.commit,
      previousCommit: first.commit,
      scanCount: 2,
      inventory: {
        trackedFiles: 4,
        manifests: ["package.json"],
        lockfiles: ["package-lock.json"],
        tests: ["app.test.ts"],
      },
    });
    expect(second.history).toHaveLength(2);
    expect(JSON.parse(await readFile(memoryPath, "utf8"))).toEqual(second);
  });
});

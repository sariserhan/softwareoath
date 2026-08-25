import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { assertSafeRepositoryWorkspace } from "./workspace.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "software-oath-workspace-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-q", root]);
  return root;
}

describe("hosted repository workspace validation", () => {
  it("accepts tracked files and symlinks contained by the repository", async () => {
    const root = await repository();
    await writeFile(join(root, "target.txt"), "ok\n");
    await symlink("target.txt", join(root, "link.txt"));
    await execFileAsync("git", ["add", "."], { cwd: root });
    await expect(assertSafeRepositoryWorkspace(root)).resolves.toBeUndefined();
  });

  it("rejects tracked symlinks that escape the repository", async () => {
    const root = await repository();
    await symlink("../outside", join(root, "escape"));
    await execFileAsync("git", ["add", "."], { cwd: root });
    await expect(assertSafeRepositoryWorkspace(root)).rejects.toThrow(
      "escapes the repository workspace",
    );
  });
});

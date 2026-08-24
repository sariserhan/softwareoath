import { execFile } from "node:child_process";
import { readlink, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith("../"));
}

export async function assertSafeRepositoryWorkspace(
  repositoryPath: string,
): Promise<void> {
  const root = await realpath(resolve(repositoryPath));
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--stage", "-z"],
    { cwd: root, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
  );
  const records = stdout.toString("utf8").split("\0").filter(Boolean);
  for (const record of records) {
    const match = record.match(/^(\d{6}) [0-9a-f]+ \d\t(.+)$/s);
    if (!match) throw new Error("Git returned an invalid tracked-file record.");
    const [, mode, path] = match;
    if (mode === "160000") {
      throw new Error(
        `Git submodule ${path} is not supported in hosted runner workspaces.`,
      );
    }
    if (mode !== "120000") continue;
    const linkPath = resolve(root, path);
    const target = await readlink(linkPath);
    const targetPath = resolve(dirname(linkPath), target);
    if (!inside(root, targetPath)) {
      throw new Error(`Tracked symlink ${path} escapes the repository workspace.`);
    }
  }
}

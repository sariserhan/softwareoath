export interface GitStatusPaths {
  changedPaths: string[];
  untrackedPaths: string[];
}

export function parsePorcelainV1Z(output: string): GitStatusPaths {
  const fields = output.split("\0");
  const changed = new Set<string>();
  const untracked = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    if (field.length < 4 || field[2] !== " ") {
      throw new Error("Git returned an invalid porcelain v1 status record.");
    }
    const status = field.slice(0, 2);
    const path = field.slice(3);
    if (!path) throw new Error("Git returned an empty changed path.");
    changed.add(path);
    if (status === "??") untracked.add(path);
    if (status.includes("R") || status.includes("C")) {
      const originalPath = fields[index + 1];
      if (!originalPath) throw new Error("Git returned an incomplete rename or copy record.");
      changed.add(originalPath);
      index += 1;
    }
  }
  return {
    changedPaths: [...changed].sort(),
    untrackedPaths: [...untracked].sort(),
  };
}

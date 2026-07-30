import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { RepairReceipt } from "../repair/types";

export class LocalArtifactStore {
  constructor(readonly root: string) {
    this.root = resolve(root);
  }

  async saveRepair(receipt: RepairReceipt): Promise<string> {
    const directory = join(this.root, receipt.id);
    await mkdir(directory, { recursive: true });
    await cp(receipt.changes.patchPath, join(directory, "repair.patch"));
    await writeFile(
      join(directory, "receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
    return directory;
  }
}

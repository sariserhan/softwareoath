import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { RepairReceipt } from "../repair/types";
import {
  verifyReceiptSignature,
  type TrustedReceiptKeys,
} from "../repair/signature";

export class LocalArtifactStore {
  constructor(readonly root: string) {
    this.root = resolve(root);
  }

  async saveRepair(
    receipt: RepairReceipt,
    trustedKeys?: TrustedReceiptKeys,
  ): Promise<string> {
    verifyReceiptSignature(receipt, trustedKeys);
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

  async readRepair(
    repairId: string,
    trustedKeys?: TrustedReceiptKeys,
  ): Promise<RepairReceipt> {
    const receipt = JSON.parse(
      await readFile(join(this.root, repairId, "receipt.json"), "utf8"),
    ) as RepairReceipt;
    verifyReceiptSignature(receipt, trustedKeys);
    return receipt;
  }
}

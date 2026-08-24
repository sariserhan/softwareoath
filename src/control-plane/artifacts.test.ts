import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { signReceipt, testReceiptSigner } from "../repair/signature";
import type { RepairReceipt } from "../repair/types";
import { LocalArtifactStore } from "./artifacts";

describe("LocalArtifactStore cost evidence", () => {
  it("persists raw estimates and rejects digest tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-cost-artifacts-"));
    const storeRoot = join(root, "store");
    const patchPath = join(root, "repair.patch");
    const baselinePath = join(root, "baseline.json");
    const proposedPath = join(root, "proposed.json");
    const baseline = '{"totalMonthlyCost":"10"}';
    const proposed = '{"totalMonthlyCost":"12"}';
    await Promise.all([
      writeFile(patchPath, "diff"),
      writeFile(baselinePath, baseline),
      writeFile(proposedPath, proposed),
    ]);
    const signer = testReceiptSigner();
    const receipt = signReceipt({
      version: 1,
      id: "REPAIR-COST",
      changes: { patchPath },
      cost: {
        artifacts: {
          baselinePath,
          proposedPath,
          baselineSha256: createHash("sha256").update(baseline).digest("hex"),
          proposedSha256: createHash("sha256").update(proposed).digest("hex"),
        },
      },
    } as Omit<RepairReceipt, "signature">, signer);
    const trustedKeys = { [signer.keyId]: signer.publicKey! };
    const store = new LocalArtifactStore(storeRoot);

    try {
      await store.saveRepair(receipt, trustedKeys);
      expect(await readFile(join(storeRoot, receipt.id, "infracost-baseline.json"), "utf8"))
        .toBe(baseline);
      await expect(store.readRepair(receipt.id, trustedKeys)).resolves.toMatchObject({
        id: receipt.id,
        cost: { artifacts: { proposedSha256: receipt.cost!.artifacts!.proposedSha256 } },
      });
      await writeFile(join(storeRoot, receipt.id, "infracost-proposed.json"), "tampered");
      await expect(store.readRepair(receipt.id, trustedKeys)).rejects.toThrow(
        "failed digest verification",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

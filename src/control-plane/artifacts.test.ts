import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { signReceipt, testReceiptSigner } from "../repair/signature.js";
import type { RepairReceipt } from "../repair/types.js";
import { LocalArtifactStore } from "./artifacts.js";

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

  it("deletes only path-safe repository and repair artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-delete-artifacts-"));
    const store = new LocalArtifactStore(root);
    const repositoryDirectory = join(root, "repositories", "owner__repo");
    const memoryPath = join(root, "memory", "owner__repo.json");
    const repairDirectory = join(root, "REPAIR-1");
    await Promise.all([mkdir(repositoryDirectory, { recursive: true }),
      mkdir(join(root, "memory"), { recursive: true }),
      mkdir(repairDirectory, { recursive: true })]);
    await Promise.all([writeFile(join(repositoryDirectory, "initial-oath.json"), "{}"),
      writeFile(memoryPath, "{}"), writeFile(join(repairDirectory, "receipt.json"), "{}")]);
    await expect(store.deleteRepositoryArtifacts("owner/repo", ["../escape"]))
      .rejects.toThrow(/unsafe/);
    await expect(store.deleteRepositoryArtifacts("owner/repo", ["REPAIR-1"]))
      .resolves.toBe(3);
    await expect(readFile(memoryPath)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(root, { recursive: true, force: true });
  });
});

import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { InitializationResult } from "../onboarding/init";
import type { RepairReceipt } from "../repair/types";
import type { ReplayReport } from "../replay/types";

export interface InitialOathDraft {
  repository: string;
  source: string;
  discoveredChecks: InitializationResult["discoveredChecks"];
  warnings: string[];
  generatedAt: string;
}
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

  async readRepairPatch(repairId: string): Promise<string> {
    return await readFile(join(this.root, repairId, "repair.patch"), "utf8");
  }

  async saveReplayReport(report: ReplayReport): Promise<string> {
    const path = join(this.root, "replays", `${report.id}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return path;
  }

  async listReplayReports(): Promise<ReplayReport[]> {
    const directory = join(this.root, "replays");
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map(async (name) =>
          JSON.parse(await readFile(join(directory, name), "utf8")) as ReplayReport,
        ),
    );
  }

  private repositoryArtifactPath(repository: string, name: string): string {
    const safeName = repository.replace(/[^a-zA-Z0-9._-]+/g, "__");
    return join(this.root, "repositories", safeName, name);
  }

  async saveInitialOathDraft(draft: InitialOathDraft): Promise<string> {
    const path = this.repositoryArtifactPath(draft.repository, "initial-oath.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(draft, null, 2) + "\n", "utf8");
    return path;
  }

  async readInitialOathDraft(repository: string): Promise<InitialOathDraft> {
    return JSON.parse(
      await readFile(this.repositoryArtifactPath(repository, "initial-oath.json"), "utf8"),
    ) as InitialOathDraft;
  }

  memoryPath(repository: string): string {
    const safeName = repository.replace(/[^a-zA-Z0-9._-]+/g, "__");
    return join(this.root, "memory", `${safeName}.json`);
  }
}

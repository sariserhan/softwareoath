import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ReplayReport } from "../replay/types.js";
import type { RepairReceipt } from "../repair/types.js";
import { verifyReceiptSignature, type TrustedReceiptKeys } from "../repair/signature.js";
import type { ArtifactStore, InitialOathDraft } from "./artifacts.js";

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safe(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error("Artifact identifier is unsafe.");
  return value;
}

export class S3ArtifactStore implements ArtifactStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix = "software-oath",
    private readonly localMemoryRoot = ".software-oath/memory",
    private readonly retentionDays = 365,
    private readonly kmsKeyId?: string,
  ) {}

  private key(name: string): string {
    return [this.prefix.replace(/\/$/, ""), name.replace(/^\//, "")].filter(Boolean).join("/");
  }

  private async put(name: string, body: Uint8Array | string): Promise<string> {
    const sha256 = digest(body);
    const retainUntil = new Date(Date.now() + this.retentionDays * 86_400_000).toISOString();
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(name),
      Body: body,
      ServerSideEncryption: this.kmsKeyId ? "aws:kms" : "AES256",
      SSEKMSKeyId: this.kmsKeyId,
      Metadata: { sha256, "retain-until": retainUntil },
    }));
    return `s3://${this.bucket}/${this.key(name)}`;
  }

  private async get(name: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket, Key: this.key(name),
    }));
    if (!result.Body) throw new Error(`Artifact ${name} has no body.`);
    const body = await result.Body.transformToByteArray();
    if (!result.Metadata?.sha256 || digest(body) !== result.Metadata.sha256) {
      throw new Error(`Artifact ${name} failed SHA-256 verification.`);
    }
    return body;
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const listed = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: prefix, ContinuationToken: token,
      }));
      keys.push(...(listed.Contents ?? []).flatMap(({ Key }) => Key ? [Key] : []));
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    for (let offset = 0; offset < keys.length; offset += 1_000) {
      const batch = keys.slice(offset, offset + 1_000);
      await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }));
    }
  }

  async saveRepair(receipt: RepairReceipt, trustedKeys?: TrustedReceiptKeys): Promise<string> {
    verifyReceiptSignature(receipt, trustedKeys);
    const id = safe(receipt.id);
    const writes: Array<Promise<string>> = [
      this.put(`repairs/${id}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n"),
      this.put(`repairs/${id}/repair.patch`, await readFile(receipt.changes.patchPath)),
    ];
    if (receipt.cost?.artifacts) {
      const baseline = await readFile(receipt.cost.artifacts.baselinePath);
      const proposed = await readFile(receipt.cost.artifacts.proposedPath);
      if (digest(baseline) !== receipt.cost.artifacts.baselineSha256 ||
          digest(proposed) !== receipt.cost.artifacts.proposedSha256) {
        throw new Error("Cost artifact failed digest verification.");
      }
      writes.push(this.put(`repairs/${id}/infracost-baseline.json`, baseline));
      writes.push(this.put(`repairs/${id}/infracost-proposed.json`, proposed));
    }
    await Promise.all(writes);
    return `s3://${this.bucket}/${this.key(`repairs/${id}`)}`;
  }

  async readRepair(repairId: string, trustedKeys?: TrustedReceiptKeys): Promise<RepairReceipt> {
    const id = safe(repairId);
    const receipt = JSON.parse(Buffer.from(await this.get(
      `repairs/${id}/receipt.json`,
    )).toString("utf8")) as RepairReceipt;
    verifyReceiptSignature(receipt, trustedKeys);
    if (receipt.cost?.artifacts) {
      const [baseline, proposed] = await Promise.all([
        this.get(`repairs/${id}/infracost-baseline.json`),
        this.get(`repairs/${id}/infracost-proposed.json`),
      ]);
      if (digest(baseline) !== receipt.cost.artifacts.baselineSha256 ||
          digest(proposed) !== receipt.cost.artifacts.proposedSha256) {
        throw new Error("Cost artifact failed digest verification.");
      }
    }
    return receipt;
  }

  async readRepairPatch(repairId: string): Promise<string> {
    return Buffer.from(await this.get(`repairs/${safe(repairId)}/repair.patch`)).toString("utf8");
  }

  async saveReplayReport(report: ReplayReport): Promise<string> {
    return await this.put(`replays/${safe(report.id)}.json`, JSON.stringify(report) + "\n");
  }

  async listReplayReports(): Promise<ReplayReport[]> {
    const prefix = this.key("replays/");
    const keys = await this.listKeys(prefix);
    return await Promise.all(keys.flatMap((Key) =>
      Key?.endsWith(".json") ? [this.get(Key.slice(this.key("").length + 1))
        .then((body) => JSON.parse(Buffer.from(body).toString("utf8")) as ReplayReport)] : []));
  }

  async saveInitialOathDraft(draft: InitialOathDraft): Promise<string> {
    return await this.put(`repositories/${this.repositoryKey(draft.repository)}/initial-oath.json`,
      JSON.stringify(draft, null, 2) + "\n");
  }

  async readInitialOathDraft(repository: string): Promise<InitialOathDraft> {
    return JSON.parse(Buffer.from(await this.get(
      `repositories/${this.repositoryKey(repository)}/initial-oath.json`,
    )).toString("utf8")) as InitialOathDraft;
  }

  async deleteRepositoryArtifacts(repository: string, repairIds: string[]): Promise<number> {
    const prefixes = [this.key(`repositories/${this.repositoryKey(repository)}/`),
      ...repairIds.map((id) => this.key(`repairs/${safe(id)}/`))];
    const keys: string[] = [];
    for (const Prefix of prefixes) keys.push(...await this.listKeys(Prefix));
    await rm(this.memoryPath(repository), { force: true });
    await this.deleteKeys(keys);
    return keys.length;
  }

  async garbageCollectExpired(now = new Date()): Promise<number> {
    const keys = await this.listKeys(this.key(""));
    const expired: string[] = [];
    for (const Key of keys) {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
      const retainUntil = head.Metadata?.["retain-until"];
      if (retainUntil && retainUntil <= now.toISOString()) expired.push(Key);
    }
    await this.deleteKeys(expired);
    return expired.length;
  }

  memoryPath(repository: string): string {
    const path = resolve(this.localMemoryRoot, `${this.repositoryKey(repository)}.json`);
    void mkdir(resolve(this.localMemoryRoot), { recursive: true });
    return path;
  }

  private repositoryKey(repository: string): string {
    return repository.replace(/[^a-zA-Z0-9._-]+/g, "__");
  }
}

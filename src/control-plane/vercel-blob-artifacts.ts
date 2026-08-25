import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { del, get, list, put } from "@vercel/blob";

import type { ReplayReport } from "../replay/types";
import type { RepairReceipt } from "../repair/types";
import { verifyReceiptSignature, type TrustedReceiptKeys } from "../repair/signature";
import type { ArtifactStore, InitialOathDraft } from "./artifacts";

const META_SUFFIX = ".software-oath-meta.json";
interface BlobMetadata { version: 1; sha256: string; retainUntil: string }
export interface VercelBlobClient { put: typeof put; get: typeof get; list: typeof list; del: typeof del }
const defaultClient: VercelBlobClient = { put, get, list, del };

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safe(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error("Artifact identifier is unsafe.");
  return value;
}

export class VercelBlobArtifactStore implements ArtifactStore {
  constructor(
    private readonly client: VercelBlobClient = defaultClient,
    private readonly prefix = "software-oath",
    private readonly localMemoryRoot = "/tmp/software-oath/memory",
    private readonly retentionDays = 365,
  ) {}

  private path(name: string): string {
    return [this.prefix.replace(/\/$/, ""), name.replace(/^\//, "")].filter(Boolean).join("/");
  }

  private async put(name: string, body: Uint8Array | string): Promise<string> {
    const pathname = this.path(name);
    const metadata: BlobMetadata = { version: 1, sha256: digest(body),
      retainUntil: new Date(Date.now() + this.retentionDays * 86_400_000).toISOString() };
    const options = { access: "private" as const, addRandomSuffix: false, allowOverwrite: true };
    const uploadBody = typeof body === "string" ? body : Buffer.from(body);
    const result = await this.client.put(pathname, uploadBody, options);
    try {
      await this.client.put(pathname + META_SUFFIX, JSON.stringify(metadata) + "\n",
        { ...options, contentType: "application/json" });
    } catch (error) {
      await this.client.del(pathname).catch(() => undefined);
      throw error;
    }
    return result.url;
  }

  private async read(pathname: string): Promise<Uint8Array> {
    const result = await this.client.get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error(`Artifact ${pathname} was not found.`);
    }
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  private async get(name: string): Promise<Uint8Array> {
    const pathname = this.path(name);
    const [body, rawMetadata] = await Promise.all([
      this.read(pathname), this.read(pathname + META_SUFFIX),
    ]);
    const metadata = JSON.parse(Buffer.from(rawMetadata).toString("utf8")) as BlobMetadata;
    if (!metadata.sha256 || digest(body) !== metadata.sha256) {
      throw new Error(`Artifact ${name} failed SHA-256 verification.`);
    }
    return body;
  }

  private async listPaths(prefix: string): Promise<string[]> {
    const paths: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.client.list({ prefix, cursor });
      paths.push(...result.blobs.map((blob) => blob.pathname));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return paths;
  }

  async saveRepair(receipt: RepairReceipt, trustedKeys?: TrustedReceiptKeys): Promise<string> {
    verifyReceiptSignature(receipt, trustedKeys);
    const id = safe(receipt.id);
    const writes = [
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
    return `vercel-blob://${this.path(`repairs/${id}`)}`;
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
    const paths = await this.listPaths(this.path("replays/"));
    return await Promise.all(paths
      .filter((pathname) => pathname.endsWith(".json") && !pathname.endsWith(META_SUFFIX)).sort()
      .map(async (pathname) => JSON.parse(Buffer.from(await this.get(
        pathname.slice(this.path("").length + 1),
      )).toString("utf8")) as ReplayReport));
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
    const prefixes = [this.path(`repositories/${this.repositoryKey(repository)}/`),
      ...repairIds.map((id) => this.path(`repairs/${safe(id)}/`))];
    const paths: string[] = [];
    for (const prefix of prefixes) paths.push(...await this.listPaths(prefix));
    await rm(this.memoryPath(repository), { force: true });
    if (paths.length) await this.client.del(paths);
    return paths.length;
  }
  async garbageCollectExpired(now = new Date()): Promise<number> {
    const metadataPaths = (await this.listPaths(this.path("")))
      .filter((pathname) => pathname.endsWith(META_SUFFIX));
    const expired: string[] = [];
    for (const metadataPath of metadataPaths) {
      const metadata = JSON.parse(
        Buffer.from(await this.read(metadataPath)).toString("utf8"),
      ) as BlobMetadata;
      if (metadata.retainUntil <= now.toISOString()) {
        expired.push(metadataPath.slice(0, -META_SUFFIX.length), metadataPath);
      }
    }
    if (expired.length) await this.client.del(expired);
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

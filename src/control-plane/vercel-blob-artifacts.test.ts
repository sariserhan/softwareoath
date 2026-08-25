import { describe, expect, it } from "vitest";

import { artifactStoreFromEnvironment } from "./artifact-config.js";
import { VercelBlobArtifactStore, type VercelBlobClient } from "./vercel-blob-artifacts.js";

function fakeClient() {
  const objects = new Map<string, Uint8Array>();
  const client = {
    async put(pathname: string, body: unknown) {
      let bytes: Uint8Array;
      if (typeof body === "string") bytes = Buffer.from(body);
      else if (body instanceof Uint8Array) bytes = new Uint8Array(body);
      else throw new Error("unsupported body");
      objects.set(pathname, bytes);
      return { url: `https://blob.test/${pathname}`, pathname };
    },
    async get(pathname: string) {
      const body = objects.get(pathname);
      if (!body) return null;
      return { statusCode: 200, stream: new ReadableStream({
        start(controller) { controller.enqueue(body); controller.close(); },
      }) };
    },
    async list(options: { prefix?: string }) {
      const prefix = options.prefix ?? "";
      return { blobs: [...objects.keys()].filter((path) => path.startsWith(prefix))
        .map((pathname) => ({ pathname })), hasMore: false };
    },
    async del(pathnames: string | string[]) {
      for (const pathname of Array.isArray(pathnames) ? pathnames : [pathnames]) {
        objects.delete(pathname);
      }
    },
  } as unknown as VercelBlobClient;
  return { client, objects };
}

describe("Vercel Blob artifact retention", () => {
  it("stores private integrity metadata, verifies reads, and removes expired pairs", async () => {
    const { client, objects } = fakeClient();
    const store = new VercelBlobArtifactStore(client, "tenant", "/tmp/software-oath-test", 30);
    const draft = { repository: "owner/repo", source: "generated", discoveredChecks: [],
      warnings: [], generatedAt: "2026-08-25T00:00:00.000Z" };

    await expect(store.saveInitialOathDraft(draft)).resolves.toBe(
      "https://blob.test/tenant/repositories/owner__repo/initial-oath.json",
    );
    expect(objects.size).toBe(2);
    await expect(store.readInitialOathDraft("owner/repo")).resolves.toEqual(draft);

    objects.set("tenant/repositories/owner__repo/initial-oath.json", Buffer.from("tampered"));
    await expect(store.readInitialOathDraft("owner/repo")).rejects.toThrow(
      /SHA-256 verification/,
    );
    await expect(store.garbageCollectExpired(
      new Date(Date.now() + 31 * 86_400_000),
    )).resolves.toBe(2);
    expect(objects.size).toBe(0);
  });

  it("is selected automatically when Vercel injects Blob credentials", () => {
    expect(artifactStoreFromEnvironment({ BLOB_READ_WRITE_TOKEN: "test-token" }))
      .toBeInstanceOf(VercelBlobArtifactStore);
  });
});

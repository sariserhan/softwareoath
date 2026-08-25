import { describe, expect, it } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";

import { artifactStoreFromEnvironment } from "./artifact-config";
import { LocalArtifactStore } from "./artifacts";
import { S3ArtifactStore } from "./s3-artifacts";

describe("S3 artifact retention", () => {
  it("encrypts objects, records retention and digest metadata, and verifies reads", async () => {
    const objects = new Map<string, { body: Uint8Array; metadata: Record<string, string> }>();
    const puts: Array<Record<string, unknown>> = [];
    const client = {
      async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
        if (command.constructor.name === "PutObjectCommand") {
          puts.push(command.input);
          const raw = command.input.Body;
          const body = typeof raw === "string" ? Buffer.from(raw) : raw as Uint8Array;
          objects.set(String(command.input.Key), {
            body, metadata: command.input.Metadata as Record<string, string>,
          });
          return {};
        }
        if (command.constructor.name === "GetObjectCommand") {
          const stored = objects.get(String(command.input.Key));
          if (!stored) throw new Error("missing");
          return { Metadata: stored.metadata, Body: {
            async transformToByteArray() { return stored.body; },
          } };
        }
        if (command.constructor.name === "HeadObjectCommand") {
          const stored = objects.get(String(command.input.Key));
          if (!stored) throw new Error("missing");
          return { Metadata: stored.metadata };
        }
        if (command.constructor.name === "ListObjectsV2Command") {
          const prefix = String(command.input.Prefix);
          return { Contents: [...objects.keys()].filter((key) => key.startsWith(prefix))
            .map((Key) => ({ Key })) };
        }
        if (command.constructor.name === "DeleteObjectsCommand") {
          const deletion = command.input.Delete as { Objects: Array<{ Key: string }> };
          deletion.Objects.forEach(({ Key }) => objects.delete(Key));
          return {};
        }
        throw new Error("unsupported command");
      },
    } as unknown as S3Client;
    const store = new S3ArtifactStore(client, "evidence", "tenant", "/tmp/memory", 30);
    const draft = { repository: "owner/repo", source: "generated",
      discoveredChecks: [], warnings: [], generatedAt: "2026-08-25T00:00:00.000Z" };

    await store.saveInitialOathDraft(draft);
    expect(puts[0]).toMatchObject({
      Bucket: "evidence", ServerSideEncryption: "AES256",
      Metadata: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        "retain-until": expect.any(String) },
    });
    await expect(store.readInitialOathDraft("owner/repo")).resolves.toEqual(draft);

    const stored = objects.values().next().value!;
    stored.body = Buffer.from("tampered");
    await expect(store.readInitialOathDraft("owner/repo")).rejects.toThrow(
      /SHA-256 verification/,
    );
    await expect(store.garbageCollectExpired(
      new Date(Date.now() + 31 * 86_400_000))).resolves.toBe(1);
    expect(objects.size).toBe(0);
  });

  it("fails closed when durable storage is required but not configured", () => {
    expect(() => artifactStoreFromEnvironment({
      SOFTWARE_OATH_REQUIRE_DURABLE_ARTIFACTS: "true",
    })).toThrow(/Durable S3 artifact storage is required/);
    expect(artifactStoreFromEnvironment({ SOFTWARE_OATH_ARTIFACT_PATH: "/tmp/artifacts" }))
      .toBeInstanceOf(LocalArtifactStore);
    expect(() => artifactStoreFromEnvironment({
      SOFTWARE_OATH_ARTIFACT_S3_BUCKET: "evidence",
      SOFTWARE_OATH_ARTIFACT_RETENTION_DAYS: "0",
    })).toThrow(/positive integer/);
  });
});

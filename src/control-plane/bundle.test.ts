import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { testReceiptSigner } from "../repair/signature.js";
import {
  computeMerkleRoot,
  exportAttestationBundle,
  verifyAttestationBundle,
} from "./bundle.js";
import { FileControlPlaneStore } from "./store.js";
import type { IncidentRecord, RepositoryKnowledgeRecord } from "./types.js";

describe("attestation bundle export & verification", () => {
  it("computes deterministic Merkle roots", () => {
    const root1 = computeMerkleRoot([{ a: 1 }, { b: 2 }]);
    const root2 = computeMerkleRoot([{ b: 2 }, { a: 1 }]);
    expect(root1).toBe(root2);
    expect(typeof root1).toBe("string");
    expect(root1.length).toBe(64);
  });

  it("exports and verifies a signed attestation bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-bundle-test-"));
    try {
      const store = new FileControlPlaneStore(join(root, "store.json"));
      const now = "2026-07-30T12:00:00Z";

      const incident: IncidentRecord = {
        id: "INCIDENT-1",
        source: "sentry",
        externalId: "EXT-1",
        title: "Database connection timeout",
        status: "active",
        receivedAt: now,
        payloadDigest: "digest-1",
      };
      await store.addIncident(incident, {
        id: "RUN-1",
        incidentId: "INCIDENT-1",
        repository: "acme/backend",
        status: "received",
      });

      const knowledge: RepositoryKnowledgeRecord = {
        id: "KNOWLEDGE-1",
        repository: "acme/backend",
        kind: "owner_confirmed_business_rule",
        statement: "No raw SQL string concatenation allowed",
        scope: { type: "repository", value: "acme/backend" },
        source: { type: "owner_answer", questionId: "Q1", evidence: ["Policy doc"] },
        confidence: 1,
        relatedPaths: ["src/db.ts"],
        blocksRepair: true,
        firstObservedAt: now,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await store.upsertKnowledge(knowledge);

      const signer = testReceiptSigner();
      const bundle = await exportAttestationBundle({
        store,
        repository: "acme/backend",
        signer,
        now: () => new Date(now),
      });

      expect(bundle.manifest.version).toBe(1);
      expect(bundle.manifest.counts.incidents).toBe(1);
      expect(bundle.manifest.counts.knowledgeRecords).toBe(1);
      expect(bundle.manifest.signature).toBeDefined();

      const verification = await verifyAttestationBundle(bundle, {
        [signer.keyId]: signer.publicKey!,
      });
      expect(verification.valid).toBe(true);
      expect(verification.summary.incidents).toBe(1);

      // Tamper check: modify an incident title
      const tamperedBundle = JSON.parse(JSON.stringify(bundle));
      tamperedBundle.incidents[0].title = "TAMPERED TITLE";

      const tamperedVerification = await verifyAttestationBundle(tamperedBundle, {
        [signer.keyId]: signer.publicKey!,
      });
      expect(tamperedVerification.valid).toBe(false);
      expect(tamperedVerification.reason).toContain("Merkle root mismatch");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

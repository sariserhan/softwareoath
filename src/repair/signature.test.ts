import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  signReceipt,
  verifyReceiptSignature,
  type ReceiptSigner,
} from "./signature";
import type { RepairReceipt } from "./types";

function signer(keyId: string): ReceiptSigner {
  const pair = generateKeyPairSync("ed25519");
  return {
    keyId,
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function unsignedReceipt(): Omit<RepairReceipt, "signature"> {
  return {
    version: 1,
    id: "REPAIR-1",
    repositoryPath: "/repository",
    baseCommit: "abc123",
    finding: {
      id: "finding",
      detector: "fixture",
      category: "maintainability",
      severity: "high",
      title: "Fixture finding",
      summary: "A deterministic fixture.",
      evidence: { path: "src/index.ts", detail: "Fixture is unhealthy." },
      repair: {
        objective: "Repair the fixture.",
        allowedPaths: ["src/index.ts"],
        automaticCandidate: true,
      },
    },
    inspection: {
      critical: 0, high: 1, medium: 0, low: 0, total: 1, automaticCandidates: 1,
    },
    agent: { name: "fixture", summary: "fixed", output: "done" },
    changes: {
      files: ["src/index.ts"],
      withinAllowedScope: true,
      patchPath: "/artifact/repair.patch",
      patchSha256: "digest",
    },
    proof: {
      selectedFindingId: "finding",
      selectedFindingResolved: true,
      remainingSelectedFinding: null,
      before: {
        critical: 0, high: 1, medium: 0, low: 0, total: 1, automaticCandidates: 1,
      },
      after: {
        critical: 0, high: 0, medium: 0, low: 0, total: 0, automaticCandidates: 0,
      },
      newFindings: [],
      blockingNewFindings: [],
    },
    verification: {} as RepairReceipt["verification"],
    decision: "ready",
    generatedAt: "2026-07-30T12:00:00.000Z",
  };
}

describe("repair receipt signatures", () => {
  it("accepts an intact receipt from a trusted Ed25519 key", () => {
    const active = signer("key-2026-07");
    const receipt = signReceipt(unsignedReceipt(), active);

    expect(() =>
      verifyReceiptSignature(receipt, { [active.keyId]: active.publicKey! }),
    ).not.toThrow();
  });

  it("rejects tampered receipt content", () => {
    const active = signer("key-2026-07");
    const receipt = signReceipt(unsignedReceipt(), active);
    receipt.decision = "blocked";

    expect(() =>
      verifyReceiptSignature(receipt, { [active.keyId]: active.publicKey! }),
    ).toThrow("signature is invalid");
  });

  it("rejects tampered signature metadata", () => {
    const active = signer("key-2026-07");
    const receipt = signReceipt(unsignedReceipt(), active);
    receipt.signature.signedAt = "2030-01-01T00:00:00.000Z";

    expect(() =>
      verifyReceiptSignature(receipt, { [active.keyId]: active.publicKey! }),
    ).toThrow("signature is invalid");
  });

  it("supports rotation while historical public keys remain trusted", () => {
    const previous = signer("key-2026-07");
    const active = signer("key-2026-08");
    const oldReceipt = signReceipt(unsignedReceipt(), previous);
    const newReceipt = signReceipt(
      { ...unsignedReceipt(), id: "REPAIR-2" },
      active,
    );
    const keyRing = {
      [previous.keyId]: previous.publicKey!,
      [active.keyId]: active.publicKey!,
    };

    expect(() => verifyReceiptSignature(oldReceipt, keyRing)).not.toThrow();
    expect(() => verifyReceiptSignature(newReceipt, keyRing)).not.toThrow();
    expect(() =>
      verifyReceiptSignature(oldReceipt, {
        [active.keyId]: active.publicKey!,
      }),
    ).toThrow("is not trusted");
  });
});

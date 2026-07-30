import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

import {
  canonicalJson,
  type ReceiptSigner,
  type TrustedReceiptKeys,
  trustedReceiptKeysFromEnvironment,
} from "../repair/signature";
import type { ReceiptSignature, RepairReceipt } from "../repair/types";
import type {
  ApprovalRecord,
  FinalAttestation,
  HostedRunRecord,
  IncidentRecord,
} from "./types";

function payload(attestation: Omit<FinalAttestation, "signature"> | FinalAttestation) {
  const value = { ...attestation } as Partial<FinalAttestation>;
  delete value.signature;
  return canonicalJson(value);
}

export function createFinalAttestation(options: {
  run: HostedRunRecord;
  incident: IncidentRecord;
  approval: ApprovalRecord;
  repairReceipt: RepairReceipt;
  signer: ReceiptSigner;
}): FinalAttestation {
  const { run, incident, approval, repairReceipt, signer } = options;
  if (!run.repairId || !run.pullRequestUrl || !run.branch) {
    throw new Error("The run is missing repair or pull-request delivery metadata.");
  }
  const privateKey = createPrivateKey(signer.privateKey);
  const publicKey =
    signer.publicKey ??
    createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const unsigned: Omit<FinalAttestation, "signature"> = {
    version: 1,
    id: `ATTESTATION-${approval.id}`,
    runId: run.id,
    incident: {
      id: incident.id,
      source: incident.source,
      externalId: incident.externalId,
      payloadDigest: incident.payloadDigest,
    },
    repository: run.repository,
    commits: {
      base: repairReceipt.baseCommit,
      repair: run.repairCommit,
    },
    delivery: {
      repairId: run.repairId,
      branch: run.branch,
      pullRequestUrl: run.pullRequestUrl,
    },
    verification: {
      decision: repairReceipt.decision,
      selectedFindingResolved: repairReceipt.proof.selectedFindingResolved,
      blockingNewFindings: repairReceipt.proof.blockingNewFindings.length,
    },
    repairReceipt: {
      sha256: createHash("sha256")
        .update(canonicalJson(repairReceipt))
        .digest("hex"),
      keyId: repairReceipt.signature.keyId,
      signature: repairReceipt.signature.value,
    },
    decision: {
      value: approval.decision,
      identity: approval.identity,
      authorization: approval.authorization,
      reason: approval.reason,
      decidedAt: approval.createdAt,
    },
    generatedAt: approval.createdAt,
  };
  const metadata = {
    algorithm: "Ed25519",
    keyId: signer.keyId,
    signedAt: approval.createdAt,
    publicKey,
  } as const;
  const signature: ReceiptSignature = {
    ...metadata,
    value: sign(
      null,
      Buffer.from(canonicalJson({ attestation: payload(unsigned), ...metadata })),
      privateKey,
    ).toString("base64"),
  };
  return { ...unsigned, signature };
}

export function verifyFinalAttestation(
  attestation: FinalAttestation,
  trustedKeys: TrustedReceiptKeys = trustedReceiptKeysFromEnvironment(),
): void {
  const trustedKey = trustedKeys[attestation.signature.keyId];
  const allowTestEmbeddedKey =
    process.env.NODE_ENV === "test" && Object.keys(trustedKeys).length === 0;
  const publicKey =
    trustedKey ?? (allowTestEmbeddedKey ? attestation.signature.publicKey : undefined);
  if (!publicKey) {
    throw new Error(`Attestation signing key ${attestation.signature.keyId} is not trusted.`);
  }
  const { algorithm, keyId, signedAt, publicKey: embeddedKey } = attestation.signature;
  if (
    algorithm !== "Ed25519" ||
    !verify(
      null,
      Buffer.from(
        canonicalJson({
          attestation: payload(attestation),
          algorithm,
          keyId,
          signedAt,
          publicKey: embeddedKey,
        }),
      ),
      createPublicKey(publicKey),
      Buffer.from(attestation.signature.value, "base64"),
    )
  ) {
    throw new Error("The final attestation signature is invalid.");
  }
}

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

import type { ReceiptSignature, RepairReceipt } from "./types.js";

export interface ReceiptSigner {
  keyId: string;
  privateKey: string;
  publicKey?: string;
}

export type TrustedReceiptKeys = Record<string, string>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function receiptPayload(
  receipt: Omit<RepairReceipt, "signature"> | RepairReceipt,
): string {
  const payload = { ...(receipt as RepairReceipt) };
  delete (payload as Partial<RepairReceipt>).signature;
  return canonicalJson(payload);
}

export function signReceipt(
  receipt: Omit<RepairReceipt, "signature">,
  signer: ReceiptSigner,
  signedAt = new Date(),
): RepairReceipt {
  const privateKey = createPrivateKey(signer.privateKey);
  const publicKey =
    signer.publicKey ??
    createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const metadata = {
    algorithm: "Ed25519",
    keyId: signer.keyId,
    signedAt: signedAt.toISOString(),
    publicKey,
  } as const;
  const signature: ReceiptSignature = {
    ...metadata,
    value: "",
  };
  signature.value = sign(
    null,
    Buffer.from(canonicalJson({ receipt: receiptPayload(receipt), ...metadata })),
    privateKey,
  ).toString("base64");
  return { ...receipt, signature };
}

export function verifyReceiptSignature(
  receipt: RepairReceipt,
  trustedKeys: TrustedReceiptKeys = trustedReceiptKeysFromEnvironment(),
): void {
  if (!receipt.signature) {
    throw new Error("The repair receipt is unsigned.");
  }
  if (receipt.signature.algorithm !== "Ed25519") {
    throw new Error(`Unsupported receipt signature algorithm ${receipt.signature.algorithm}.`);
  }
  const trustedKey = trustedKeys[receipt.signature.keyId];
  const allowTestEmbeddedKey =
    process.env.NODE_ENV === "test" && Object.keys(trustedKeys).length === 0;
  const publicKey = trustedKey ?? (allowTestEmbeddedKey ? receipt.signature.publicKey : undefined);
  if (!publicKey) {
    throw new Error(`Receipt signing key ${receipt.signature.keyId} is not trusted.`);
  }
  if (
    !verify(
      null,
      Buffer.from(
        canonicalJson({
          receipt: receiptPayload(receipt),
          algorithm: receipt.signature.algorithm,
          keyId: receipt.signature.keyId,
          signedAt: receipt.signature.signedAt,
          publicKey: receipt.signature.publicKey,
        }),
      ),
      createPublicKey(publicKey),
      Buffer.from(receipt.signature.value, "base64"),
    )
  ) {
    throw new Error("The repair receipt signature is invalid.");
  }
}

export function receiptSignerFromEnvironment(): ReceiptSigner {
  const privateKey = process.env.SOFTWARE_OATH_RECEIPT_PRIVATE_KEY?.replaceAll(
    "\\n",
    "\n",
  );
  const keyId = process.env.SOFTWARE_OATH_RECEIPT_KEY_ID;
  if (privateKey && keyId) return { privateKey, keyId };
  if (process.env.NODE_ENV === "test") return testReceiptSigner();
  throw new Error(
    "SOFTWARE_OATH_RECEIPT_PRIVATE_KEY and SOFTWARE_OATH_RECEIPT_KEY_ID are required.",
  );
}

export function trustedReceiptKeysFromEnvironment(): TrustedReceiptKeys {
  const source = process.env.SOFTWARE_OATH_RECEIPT_PUBLIC_KEYS;
  if (!source) return {};
  const parsed = JSON.parse(source) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).map(([keyId, key]) => {
      if (typeof key !== "string" || !key.trim()) {
        throw new Error(`Trusted receipt key ${keyId} must be a PEM string.`);
      }
      return [keyId, key.replaceAll("\\n", "\n")];
    }),
  );
}

let testSigner: ReceiptSigner | undefined;
export function testReceiptSigner(): ReceiptSigner {
  if (!testSigner) {
    const pair = generateKeyPairSync("ed25519");
    testSigner = {
      keyId: "test-key",
      privateKey: pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
  }
  return testSigner;
}

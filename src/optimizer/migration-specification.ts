import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { canonicalJson } from "../repair/signature.js";
import type { ReceiptSigner, TrustedReceiptKeys } from "../repair/signature.js";
import { parseMigrationSpecification } from "./contracts.js";
import type {
  MigrationSpecificationProseV1,
  RecommendationV1,
  SignedMigrationSpecificationV1,
} from "./types.js";

function nonEmptyStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must contain non-empty strings.`);
  }
  return value as string[];
}

export function parseMigrationSpecificationProse(
  value: unknown,
): MigrationSpecificationProseV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Migration prose must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.summary !== "string" || !raw.summary.trim()) {
    throw new Error("Migration prose version and summary are required.");
  }
  return {
    version: 1,
    summary: raw.summary,
    preservedBehavior: nonEmptyStrings(raw.preservedBehavior, "preservedBehavior"),
    sequence: nonEmptyStrings(raw.sequence, "sequence"),
    verification: nonEmptyStrings(raw.verification, "verification"),
    rollout: nonEmptyStrings(raw.rollout, "rollout"),
    rollback: nonEmptyStrings(raw.rollback, "rollback"),
  };
}

export function renderMigrationSpecificationProse(
  input: unknown,
): MigrationSpecificationProseV1 {
  const specification = parseMigrationSpecification(input);
  return {
    version: 1,
    summary: `Prepare a bounded ${specification.sourceServiceId} to ${specification.targetServiceId} migration for ${specification.repository} at ${specification.baseCommit.slice(0, 12)}.`,
    preservedBehavior: [...specification.requiredBehavior],
    sequence: [...specification.migrationSequence],
    verification: [...specification.verificationRequirements],
    rollout: [...specification.rolloutPlan],
    rollback: [...specification.rollbackPlan],
  };
}

function unsignedPayload(
  envelope: Omit<SignedMigrationSpecificationV1, "signature" | "authorization">,
): string {
  return canonicalJson(envelope);
}

export function signMigrationSpecification(options: {
  specification: unknown;
  recommendation: RecommendationV1;
  versions: SignedMigrationSpecificationV1["versions"];
  signer: ReceiptSigner;
  signedAt?: Date;
}): SignedMigrationSpecificationV1 {
  const specification = parseMigrationSpecification(options.specification);
  if (options.recommendation.inputSha256 !== specification.recommendationSha256) {
    throw new Error("Recommendation digest does not match the migration specification.");
  }
  const prose = renderMigrationSpecificationProse(specification);
  for (const [name, version] of Object.entries(options.versions)) {
    if (!version.trim()) throw new Error(`${name} is required.`);
  }
  const unsigned = {
    version: 1 as const,
    specification,
    recommendation: options.recommendation,
    prose,
    versions: options.versions,
  };
  const privateKey = createPrivateKey(options.signer.privateKey);
  const publicKey = options.signer.publicKey ??
    createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const metadata = {
    algorithm: "Ed25519" as const,
    keyId: options.signer.keyId,
    signedAt: (options.signedAt ?? new Date()).toISOString(),
    publicKey,
  };
  const value = sign(
    null,
    Buffer.from(canonicalJson({ payload: unsignedPayload(unsigned), ...metadata })),
    privateKey,
  ).toString("base64");
  return { ...unsigned, signature: { ...metadata, value } };
}

export function verifyMigrationSpecification(
  envelope: SignedMigrationSpecificationV1,
  trustedKeys: TrustedReceiptKeys,
): void {
  parseMigrationSpecification(envelope.specification);
  if (envelope.recommendation.inputSha256 !== envelope.specification.recommendationSha256) {
    throw new Error("Recommendation digest does not match the migration specification.");
  }
  const expectedProse = renderMigrationSpecificationProse(envelope.specification);
  if (canonicalJson(envelope.prose) !== canonicalJson(expectedProse)) {
    throw new Error("Migration specification prose does not match structured inputs.");
  }
  const publicKey = trustedKeys[envelope.signature.keyId];
  if (!publicKey) throw new Error(`Migration signing key ${envelope.signature.keyId} is not trusted.`);
  const unsigned = {
    version: envelope.version,
    specification: envelope.specification,
    recommendation: envelope.recommendation,
    prose: envelope.prose,
    versions: envelope.versions,
  };
  const valid = verify(
    null,
    Buffer.from(canonicalJson({
      payload: unsignedPayload(unsigned),
      algorithm: envelope.signature.algorithm,
      keyId: envelope.signature.keyId,
      signedAt: envelope.signature.signedAt,
      publicKey: envelope.signature.publicKey,
    })),
    createPublicKey(publicKey),
    Buffer.from(envelope.signature.value, "base64"),
  );
  if (!valid) throw new Error("Migration specification signature is invalid.");
}

export function authorizeMigrationSpecification(
  envelope: SignedMigrationSpecificationV1,
  authorization: NonNullable<SignedMigrationSpecificationV1["authorization"]>,
): SignedMigrationSpecificationV1 {
  if (envelope.authorization) throw new Error("Migration specification is already authorized.");
  if (authorization.reason.trim().length < 3) throw new Error("Authorization reason is required.");
  return { ...envelope, authorization };
}

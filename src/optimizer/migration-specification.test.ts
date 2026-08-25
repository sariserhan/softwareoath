import { describe, expect, it } from "vitest";

import { testReceiptSigner } from "../repair/signature";
import {
  authorizeMigrationSpecification,
  parseMigrationSpecificationProse,
  renderMigrationSpecificationProse,
  signMigrationSpecification,
  verifyMigrationSpecification,
} from "./migration-specification";

const specification = {
  version: 1 as const, id: "MIGRATION-1", repository: "acme/storefront",
  baseCommit: "a".repeat(40), sourceServiceId: "resend", targetServiceId: "ses",
  recommendationSha256: "b".repeat(64), evidenceSha256: "c".repeat(64),
  requiredBehavior: ["Send transactional receipts."], knownIncompatibilities: [],
  allowedPaths: ["src/email.ts", "infra/email.tf"],
  configurationChanges: ["Replace the provider API key."],
  infrastructureChanges: ["Create the SES domain identity."],
  migrationSequence: ["Add an SES adapter.", "Switch the email call site."],
  verificationRequirements: ["Run email contract tests."],
  rolloutPlan: ["Canary ten percent of traffic."], rollbackPlan: ["Restore the Resend adapter."],
  expectedMonthlyCost: { minimum: 5, likely: 7, maximum: 10 },
  assumptions: ["50,000 messages monthly."], unresolvedDecisions: [],
  generatedAt: "2026-08-25T00:00:00.000Z", generatorVersion: "optimizer-o7",
};
const recommendation = {
  version: 1 as const,
  type: "replace" as const,
  sourceServiceId: "resend",
  targetServiceId: "ses",
  compatibilityStatus: "compatible" as const,
  annualSavings: { minimum: 100, likely: 120, maximum: 140 },
  riskAdjustedAnnualValue: { minimum: 80, likely: 100, maximum: 120 },
  paybackMonths: { minimum: 1, likely: 2, maximum: 3 },
  reasons: ["Validated savings."], unknowns: [], policyVersion: "policy-1",
  inputSha256: "b".repeat(64),
};

const versions = { catalogVersion: "email-1", pricingVersion: "pricing-1", promptVersion: "prompt-1", modelVersion: "deterministic-no-model" };

describe("optimizer O7 migration specification", () => {
  it("renders prose only from validated structured fields", () => {
    const prose = renderMigrationSpecificationProse(specification);
    expect(prose).toMatchObject({ preservedBehavior: specification.requiredBehavior, sequence: specification.migrationSequence });
    expect(() => renderMigrationSpecificationProse({ ...specification, allowedPaths: ["../escape"] })).toThrow(/repository-relative/);
    expect(() => parseMigrationSpecificationProse({ version: 1, summary: "ok" })).toThrow(/preservedBehavior/);
  });

  it("binds specification and all versions into a verifiable signature", () => {
    const signer = testReceiptSigner();
    const signed = signMigrationSpecification({ specification, recommendation, versions, signer, signedAt: new Date("2026-08-25T01:00:00.000Z") });
    expect(signed.signature).toMatchObject({ algorithm: "Ed25519", keyId: signer.keyId });
    verifyMigrationSpecification(signed, { [signer.keyId]: signer.publicKey! });
    expect(() => verifyMigrationSpecification({ ...signed, versions: { ...versions, pricingVersion: "tampered" } }, { [signer.keyId]: signer.publicKey! })).toThrow(/invalid/);
    expect(() => verifyMigrationSpecification({ ...signed, prose: { ...signed.prose, summary: "Invented claim." } }, { [signer.keyId]: signer.publicKey! })).toThrow(/does not match/);
  });

  it("records a separate one-time owner authorization", () => {
    const signer = testReceiptSigner();
    const signed = signMigrationSpecification({ specification, recommendation, versions, signer });
    const authorized = authorizeMigrationSpecification(signed, {
      actor: { provider: "github", providerUserId: "42", login: "owner" },
      permission: "maintain", reason: "Prepare this reviewed migration.",
      authorizedAt: "2026-08-25T02:00:00.000Z", runId: "RUN-1",
    });
    expect(authorized.authorization?.runId).toBe("RUN-1");
    expect(() => authorizeMigrationSpecification(authorized, authorized.authorization!)).toThrow(/already authorized/);
  });
});

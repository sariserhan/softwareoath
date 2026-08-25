import { createHash } from "node:crypto";

import { canonicalJson } from "../repair/signature.js";
import type {
  GoldFixtureExpectationV1,
  MigrationOutcomeV1,
  MigrationSpecificationV1,
  OptimizerProvenance,
  PriceRangeV1,
  RecommendationPolicyV1,
} from "./types.js";

const provenances = new Set<OptimizerProvenance>([
  "observed",
  "inferred",
  "owner_confirmed",
  "provider_derived",
  "assumed",
  "estimated",
]);

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(field + " must be an object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(field + " must be a non-empty string");
  }
  return value;
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(field + " must be an array");
  return value.map((entry, index) => string(entry, field + "[" + index + "]"));
}

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(field + " must be a non-negative finite number");
  }
  return value;
}

function isoDate(value: unknown, field: string): string {
  const result = string(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(field + " must be an ISO date");
  return result;
}

function sha256(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(field + " must be a SHA-256 digest");
  return result;
}
function gitObjectId(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result)) {
    throw new Error(field + " must be a Git object ID");
  }
  return result;
}

function path(value: unknown, field: string): string {
  const result = string(value, field);
  if (result.startsWith("/") || result.split(/[\\/]/).includes("..")) {
    throw new Error(field + " must be repository-relative");
  }
  return result;
}

export function parsePriceRange(value: unknown, field = "priceRange"): PriceRangeV1 {
  const raw = record(value, field);
  const minimum = nonNegative(raw.minimum, field + ".minimum");
  const likely = nonNegative(raw.likely, field + ".likely");
  const maximum = nonNegative(raw.maximum, field + ".maximum");
  if (minimum > likely || likely > maximum) {
    throw new Error(field + " must satisfy minimum <= likely <= maximum");
  }
  return { minimum, likely, maximum };
}

export function parseRecommendationPolicy(
  value: unknown,
): RecommendationPolicyV1 {
  const raw = record(value, "policy");
  if (raw.version !== 1) throw new Error("policy.version must be 1");
  if (typeof raw.allowReplaceWithChangedCapabilities !== "boolean") {
    throw new Error("policy.allowReplaceWithChangedCapabilities must be a boolean");
  }
  return {
    version: 1,
    minimumAnnualSavings: nonNegative(
      raw.minimumAnnualSavings,
      "policy.minimumAnnualSavings",
    ),
    maximumPaybackMonths: nonNegative(
      raw.maximumPaybackMonths,
      "policy.maximumPaybackMonths",
    ),
    allowReplaceWithChangedCapabilities: raw.allowReplaceWithChangedCapabilities,
    maximumAnnualOperationalCost: raw.maximumAnnualOperationalCost === undefined
      ? undefined
      : nonNegative(
        raw.maximumAnnualOperationalCost, "policy.maximumAnnualOperationalCost",
      ),
  };
}

export function parseMigrationSpecification(
  value: unknown,
): MigrationSpecificationV1 {
  const raw = record(value, "migrationSpecification");
  if (raw.version !== 1) throw new Error("migrationSpecification.version must be 1");
  const allowedPaths = strings(raw.allowedPaths, "migrationSpecification.allowedPaths")
    .map((entry, index) => path(entry, "migrationSpecification.allowedPaths[" + index + "]"));
  if (!allowedPaths.length) {
    throw new Error("migrationSpecification.allowedPaths must not be empty");
  }
  const result: MigrationSpecificationV1 = {
    version: 1,
    id: string(raw.id, "migrationSpecification.id"),
    repository: string(raw.repository, "migrationSpecification.repository"),
    baseCommit: gitObjectId(raw.baseCommit, "migrationSpecification.baseCommit"),
    sourceServiceId: string(raw.sourceServiceId, "migrationSpecification.sourceServiceId"),
    targetServiceId: string(raw.targetServiceId, "migrationSpecification.targetServiceId"),
    recommendationSha256: sha256(
      raw.recommendationSha256,
      "migrationSpecification.recommendationSha256",
    ),
    evidenceSha256: sha256(raw.evidenceSha256, "migrationSpecification.evidenceSha256"),
    requiredBehavior: strings(
      raw.requiredBehavior,
      "migrationSpecification.requiredBehavior",
    ),
    knownIncompatibilities: strings(
      raw.knownIncompatibilities,
      "migrationSpecification.knownIncompatibilities",
    ),
    allowedPaths,
    configurationChanges: strings(
      raw.configurationChanges,
      "migrationSpecification.configurationChanges",
    ),
    infrastructureChanges: strings(
      raw.infrastructureChanges,
      "migrationSpecification.infrastructureChanges",
    ),
    migrationSequence: strings(
      raw.migrationSequence,
      "migrationSpecification.migrationSequence",
    ),
    verificationRequirements: strings(
      raw.verificationRequirements,
      "migrationSpecification.verificationRequirements",
    ),
    rolloutPlan: strings(raw.rolloutPlan, "migrationSpecification.rolloutPlan"),
    rollbackPlan: strings(raw.rollbackPlan, "migrationSpecification.rollbackPlan"),
    expectedMonthlyCost: parsePriceRange(
      raw.expectedMonthlyCost,
      "migrationSpecification.expectedMonthlyCost",
    ),
    assumptions: strings(raw.assumptions, "migrationSpecification.assumptions"),
    unresolvedDecisions: strings(
      raw.unresolvedDecisions,
      "migrationSpecification.unresolvedDecisions",
    ),
    generatedAt: isoDate(raw.generatedAt, "migrationSpecification.generatedAt"),
    generatorVersion: string(
      raw.generatorVersion,
      "migrationSpecification.generatorVersion",
    ),
  };
  if (!result.requiredBehavior.length || !result.verificationRequirements.length) {
    throw new Error("migration specification requires behavior and verification");
  }
  return result;
}

export function parseMigrationOutcome(value: unknown): MigrationOutcomeV1 {
  const raw = record(value, "migrationOutcome");
  if (raw.version !== 1) throw new Error("migrationOutcome.version must be 1");
  const status = string(raw.status, "migrationOutcome.status");
  if (!["verified_draft_pr", "merged", "rejected", "abandoned"].includes(status)) {
    throw new Error("migrationOutcome.status is invalid");
  }
  const result: MigrationOutcomeV1 = {
    version: 1,
    id: string(raw.id, "migrationOutcome.id"),
    tenantKey: string(raw.tenantKey, "migrationOutcome.tenantKey"),
    repositoryId: string(raw.repositoryId, "migrationOutcome.repositoryId"),
    repository: string(raw.repository, "migrationOutcome.repository"),
    baseCommit: gitObjectId(raw.baseCommit, "migrationOutcome.baseCommit"),
    specificationSha256: sha256(raw.specificationSha256, "migrationOutcome.specificationSha256"),
    runId: string(raw.runId, "migrationOutcome.runId"),
    status: status as MigrationOutcomeV1["status"],
    pullRequestUrl: raw.pullRequestUrl === undefined
      ? undefined : string(raw.pullRequestUrl, "migrationOutcome.pullRequestUrl"),
    predictedEngineeringHours: parsePriceRange(
      raw.predictedEngineeringHours, "migrationOutcome.predictedEngineeringHours",
    ),
    reviewedEngineeringHours: raw.reviewedEngineeringHours === undefined
      ? undefined : nonNegative(raw.reviewedEngineeringHours, "migrationOutcome.reviewedEngineeringHours"),
    realizedMonthlySavings: raw.realizedMonthlySavings === undefined
      ? undefined : parsePriceRange(raw.realizedMonthlySavings, "migrationOutcome.realizedMonthlySavings"),
    reviewedBy: raw.reviewedBy === undefined
      ? undefined : string(raw.reviewedBy, "migrationOutcome.reviewedBy"),
    reviewedAt: raw.reviewedAt === undefined
      ? undefined : isoDate(raw.reviewedAt, "migrationOutcome.reviewedAt"),
    recordedAt: isoDate(raw.recordedAt, "migrationOutcome.recordedAt"),
    provenance: assertProvenance(raw.provenance),
    contentSha256: sha256(raw.contentSha256, "migrationOutcome.contentSha256"),
  };
  if (result.status === "verified_draft_pr" && !result.pullRequestUrl) {
    throw new Error("verified draft PR outcomes require pullRequestUrl");
  }
  if ((result.reviewedBy && !result.reviewedAt) || (!result.reviewedBy && result.reviewedAt)) {
    throw new Error("migration outcome review identity and timestamp must be paired");
  }
  return result;
}

export function parseGoldFixtureExpectation(
  value: unknown,
): GoldFixtureExpectationV1 {
  const raw = record(value, "fixture");
  if (raw.version !== 1) throw new Error("fixture.version must be 1");
  const status = string(raw.expectedStatus, "fixture.expectedStatus");
  if (!["active", "ambiguous", "inactive"].includes(status)) {
    throw new Error("fixture.expectedStatus is invalid");
  }
  const serviceId = string(raw.serviceId, "fixture.serviceId");
  return {
    version: 1,
    fixture: string(raw.fixture, "fixture.fixture"),
    serviceId,
    expectedStatus: status as GoldFixtureExpectationV1["expectedStatus"],
    expectedCapabilities: strings(
      raw.expectedCapabilities,
      "fixture.expectedCapabilities",
    ),
    excludedSignals: strings(raw.excludedSignals, "fixture.excludedSignals"),
    notes: strings(raw.notes, "fixture.notes"),
  };
}

export function optimizerDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function assertProvenance(value: unknown): OptimizerProvenance {
  if (typeof value !== "string" || !provenances.has(value as OptimizerProvenance)) {
    throw new Error("provenance is invalid");
  }
  return value as OptimizerProvenance;
}

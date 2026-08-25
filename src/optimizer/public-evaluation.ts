import type {
  EvaluationMetricsV1,
  ServiceObservationV1,
} from "./types.js";

export interface PublicRepositoryExpectationV1 {
  repository: string;
  commit: string;
  expectedStatus: ServiceObservationV1["status"];
  expectedCapabilities: string[];
  reviewedPaths: string[];
  notes: string[];
}

export interface PublicRepositoryEvaluationSetV1 {
  version: 1;
  reviewedAt: string;
  serviceId: "resend";
  repositories: PublicRepositoryExpectationV1[];
}

export interface PublicRepositoryResultV1 {
  repository: string;
  commit: string;
  actualStatus?: ServiceObservationV1["status"];
  actualCapabilities?: string[];
  error?: string;
}

export interface PublicEvaluationSummaryV1 {
  version: 1;
  repositories: number;
  unsupported: number;
  statusMatches: number;
  exactCapabilityMatches: number;
  capabilityAccuracy: number;
  serviceDetection: EvaluationMetricsV1;
  passed: boolean;
}

export function validatePublicEvaluationSet(
  value: PublicRepositoryEvaluationSetV1,
): void {
  if (value.version !== 1 || value.serviceId !== "resend") {
    throw new Error("Public optimizer evaluation metadata is unsupported.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt)) {
    throw new Error("Public optimizer evaluation review date is invalid.");
  }
  if (value.repositories.length < 4) {
    throw new Error("Public optimizer evaluation requires at least four repositories.");
  }
  const repositories = new Set<string>();
  for (const item of value.repositories) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repository)) {
      throw new Error("Public optimizer repository identity is invalid.");
    }
    if (repositories.has(item.repository)) {
      throw new Error("Public optimizer repositories must be unique.");
    }
    repositories.add(item.repository);
    if (!/^[a-f0-9]{40}$/.test(item.commit)) {
      throw new Error("Public optimizer commits must be immutable SHA-1 values.");
    }
    if (!["active", "ambiguous", "inactive"].includes(item.expectedStatus)) {
      throw new Error("Public optimizer expected status is invalid.");
    }
    if (
      new Set(item.expectedCapabilities).size !== item.expectedCapabilities.length ||
      item.expectedCapabilities.some(
        (capability) => !/^[a-z][a-z0-9_]{0,63}$/.test(capability),
      )
    ) {
      throw new Error("Public optimizer capability labels are invalid.");
    }
    if (!item.reviewedPaths.length) {
      throw new Error("Public optimizer labels require reviewed paths.");
    }
  }
}

export function summarizePublicEvaluation(
  expected: PublicRepositoryExpectationV1[],
  results: PublicRepositoryResultV1[],
): PublicEvaluationSummaryV1 {
  const resultByRepository = new Map(
    results.map((result) => [result.repository, result]),
  );
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let statusMatches = 0;
  let exactCapabilityMatches = 0;
  let unsupported = 0;

  for (const item of expected) {
    const result = resultByRepository.get(item.repository);
    if (!result?.actualStatus || !result.actualCapabilities) {
      unsupported += 1;
      continue;
    }
    const expectedActive = item.expectedStatus === "active";
    const actualActive = result.actualStatus === "active";
    if (expectedActive && actualActive) truePositive += 1;
    if (!expectedActive && actualActive) falsePositive += 1;
    if (expectedActive && !actualActive) falseNegative += 1;
    if (item.expectedStatus === result.actualStatus) statusMatches += 1;

    const expectedCapabilities = [...item.expectedCapabilities].sort();
    const actualCapabilities = [...result.actualCapabilities].sort();
    if (JSON.stringify(expectedCapabilities) === JSON.stringify(actualCapabilities)) {
      exactCapabilityMatches += 1;
    }
  }

  const precisionDenominator = truePositive + falsePositive;
  const recallDenominator = truePositive + falseNegative;
  const serviceDetection: EvaluationMetricsV1 = {
    version: 1,
    truePositive,
    falsePositive,
    falseNegative,
    precision: precisionDenominator ? truePositive / precisionDenominator : 1,
    recall: recallDenominator ? truePositive / recallDenominator : 1,
  };
  const repositories = expected.length;
  const capabilityAccuracy = repositories
    ? exactCapabilityMatches / repositories
    : 0;
  return {
    version: 1,
    repositories,
    unsupported,
    statusMatches,
    exactCapabilityMatches,
    capabilityAccuracy,
    serviceDetection,
    passed:
      unsupported === 0 &&
      statusMatches === repositories &&
      exactCapabilityMatches === repositories &&
      serviceDetection.precision >= 0.95,
  };
}

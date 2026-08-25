export interface M7RepositoryEvidenceV1 {
  repositorySha256: string;
  ownerEngaged: boolean;
  completedJourneyWithoutIntervention: boolean;
}

export interface M7RepairEvidenceV1 {
  id: string;
  repositorySha256: string;
  reproductionConfirmed: boolean;
  selectedFindingFalsePositive: boolean;
  patchRejected: boolean;
  requiredEvidencePassed: boolean;
  ciPassed: boolean;
  ownerDecision: "accepted" | "rejected" | "pending";
  maintainableByEngineer?: boolean;
  reviewDurationMinutes?: number;
}

export interface M7EvidenceV1 {
  version: 1;
  generatedAt: string;
  supportedMatrixPublished: boolean;
  betaTermsPublished: boolean;
  disconnectAndDeletionVerified: boolean;
  instrumentationVerified: boolean;
  historicalReplays: number;
  historicalReproductions: number;
  repositories: M7RepositoryEvidenceV1[];
  repairs: M7RepairEvidenceV1[];
}

function timestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function evaluateM7Readiness(value: unknown) {
  const evidence = value as Partial<M7EvidenceV1> | undefined;
  const repositories = Array.isArray(evidence?.repositories) ? evidence.repositories : [];
  const repairs = Array.isArray(evidence?.repairs) ? evidence.repairs : [];
  const validRepositories = repositories.filter((item) =>
    /^[a-f0-9]{64}$/.test(item?.repositorySha256) &&
    typeof item.ownerEngaged === "boolean" &&
    typeof item.completedJourneyWithoutIntervention === "boolean");
  const validRepairs = repairs.filter((item) =>
    typeof item?.id === "string" && item.id.length > 0 &&
    /^[a-f0-9]{64}$/.test(item.repositorySha256) &&
    typeof item.reproductionConfirmed === "boolean" &&
    typeof item.selectedFindingFalsePositive === "boolean" &&
    typeof item.patchRejected === "boolean" &&
    typeof item.requiredEvidencePassed === "boolean" &&
    typeof item.ciPassed === "boolean" &&
    ["accepted", "rejected", "pending"].includes(item.ownerDecision) &&
    (item.reviewDurationMinutes === undefined ||
      (Number.isFinite(item.reviewDurationMinutes) && item.reviewDurationMinutes >= 0)));
  const accepted = validRepairs.filter(({ ownerDecision }) => ownerDecision === "accepted");
  const metrics = {
    repositories: new Set(validRepositories.map(({ repositorySha256 }) => repositorySha256)).size,
    engagedOwners: validRepositories.filter(({ ownerEngaged }) => ownerEngaged).length,
    interventionFreeJourneys: validRepositories.filter(
      ({ completedJourneyWithoutIntervention }) => completedJourneyWithoutIntervention,
    ).length,
    repairs: validRepairs.length,
    falsePositives: validRepairs.filter(({ selectedFindingFalsePositive }) =>
      selectedFindingFalsePositive).length,
    rejectedPatches: validRepairs.filter(({ patchRejected }) => patchRejected).length,
    acceptedRepairs: accepted.length,
    maintainableAcceptedRepairs: accepted.filter(({ maintainableByEngineer }) =>
      maintainableByEngineer === true).length,
    failedEvidenceAdvanced: validRepairs.filter(({ requiredEvidencePassed, ownerDecision }) =>
      !requiredEvidencePassed && ownerDecision !== "pending").length,
  };
  const checks = [
    { id: "evidence.schema", passed: evidence?.version === 1 && timestamp(evidence.generatedAt) &&
      validRepositories.length === repositories.length && validRepairs.length === repairs.length,
      detail: "Evidence is versioned and all repository and repair records are valid." },
    { id: "beta.published_contract", passed: evidence?.supportedMatrixPublished === true &&
      evidence.betaTermsPublished === true,
      detail: "The support matrix and beta expectations are published." },
    { id: "beta.data_controls", passed: evidence?.disconnectAndDeletionVerified === true,
      detail: "Disconnect and repository-data deletion controls are verified." },
    { id: "beta.instrumentation", passed: evidence?.instrumentationVerified === true,
      detail: "Installation-through-owner-decision instrumentation is verified." },
    { id: "beta.repositories", passed: metrics.repositories >= 3 && metrics.repositories <= 5 &&
      metrics.engagedOwners === metrics.repositories,
      detail: "Three to five distinct repositories have engaged owners." },
    { id: "beta.replays", passed: Number(evidence?.historicalReplays) >= 5 &&
      Number(evidence?.historicalReproductions) >= 3,
      detail: "At least five incidents were replayed and at least three reproduced." },
    { id: "beta.accepted_repairs", passed: metrics.maintainableAcceptedRepairs >= 2,
      detail: "Engineers accepted at least two maintainable repairs." },
    { id: "beta.evidence_safety", passed: metrics.failedEvidenceAdvanced === 0,
      detail: "No repair with failed required evidence advanced to an owner decision." },
    { id: "beta.exit", passed: metrics.interventionFreeJourneys >= 1,
      detail: "At least one repository repeatedly completed the journey without intervention." },
  ];
  return { ready: checks.every(({ passed }) => passed), metrics, checks };
}

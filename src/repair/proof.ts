import type {
  InspectionReport,
  RepositoryFinding,
} from "../detector/types.js";
import type { RepairProof, RepairReceipt } from "./types.js";

export function compareRepairProof(
  before: InspectionReport,
  after: InspectionReport,
  selectedFinding: RepositoryFinding,
): RepairProof {
  const beforeIds = new Set(before.findings.map(({ id }) => id));
  const beforeById = new Map(
    before.findings.map((finding) => [finding.id, finding]),
  );
  const remainingSelectedFinding =
    after.findings.find(({ id }) => id === selectedFinding.id) ?? null;
  const newFindings = after.findings.filter(({ id }) => !beforeIds.has(id));
  const blockingNewFindings = after.findings.filter(
    ({ id, severity }) =>
      (severity === "critical" || severity === "high") &&
      !["critical", "high"].includes(beforeById.get(id)?.severity ?? ""),
  );

  return {
    selectedFindingId: selectedFinding.id,
    selectedFindingResolved: remainingSelectedFinding === null,
    remainingSelectedFinding,
    before: before.summary,
    after: after.summary,
    newFindings,
    blockingNewFindings,
  };
}

export function repairDecision(input: {
  withinAllowedScope: boolean;
  hasPatch: boolean;
  verificationDecision: RepairReceipt["decision"];
  proof: RepairProof;
}): RepairReceipt["decision"] {
  if (
    !input.withinAllowedScope ||
    !input.hasPatch ||
    input.verificationDecision === "blocked" ||
    !input.proof.selectedFindingResolved ||
    input.proof.blockingNewFindings.length > 0
  ) {
    return "blocked";
  }
  return input.verificationDecision;
}

import { describe, expect, it } from "vitest";

import { signReceipt, testReceiptSigner } from "../repair/signature";
import type { RepairReceipt } from "../repair/types";
import {
  createFinalAttestation,
  verifyFinalAttestation,
} from "./attestation";
import type {
  ApprovalRecord,
  HostedRunRecord,
  IncidentRecord,
} from "./types";

function fixture() {
  const signer = testReceiptSigner();
  const receipt = signReceipt(
    {
      version: 1,
      id: "REPAIR-1",
      repositoryPath: "/repo",
      baseCommit: "base-sha",
      proof: {
        selectedFindingResolved: true,
        blockingNewFindings: [],
      },
      cost: {
        status: "passed",
        currency: "USD",
        monthlyCostChange: 0,
        percentageChange: 0,
        artifacts: {
          baselineSha256: "baseline-digest",
          proposedSha256: "proposed-digest",
        },
      },
      decision: "ready",
    } as Omit<RepairReceipt, "signature">,
    signer,
    new Date("2026-07-30T12:00:00Z"),
  );
  const run = {
    id: "RUN-1",
    incidentId: "INC-1",
    repository: "owner/repo",
    repairId: receipt.id,
    commit: "base-sha",
    repairCommit: "repair-sha",
    branch: "software-oath/repair-1",
    pullRequestUrl: "https://github.test/owner/repo/pull/1",
    status: "awaiting_approval",
  } as HostedRunRecord;
  const incident = {
    id: "INC-1",
    source: "sentry",
    externalId: "SENTRY-1",
    payloadDigest: "incident-digest",
  } as IncidentRecord;
  const approval: ApprovalRecord = {
    id: "APPROVAL-1",
    runId: run.id,
    decision: "approved",
    actor: "reviewer@example.com",
    identity: {
      provider: "github",
      providerUserId: "42",
      login: "reviewer",
    },
    authorization: {
      repository: run.repository,
      permission: "maintain",
      verifiedAt: "2026-07-30T12:05:00.000Z",
    },
    reason: "Independent evidence reviewed.",
    createdAt: "2026-07-30T12:05:00.000Z",
  };
  return { signer, receipt, run, incident, approval };
}

describe("final decision attestation", () => {
  it("chains delivery, verification, repair receipt, and human decision", () => {
    const values = fixture();
    const attestation = createFinalAttestation({
      ...values,
      repairReceipt: values.receipt,
    });

    expect(attestation).toMatchObject({
      runId: "RUN-1",
      commits: { base: "base-sha", repair: "repair-sha" },
      decision: {
        value: "approved",
        identity: { providerUserId: "42", login: "reviewer" },
        authorization: { permission: "maintain" },
      },
      delivery: { repairId: "REPAIR-1" },
      verification: {
        decision: "ready",
        selectedFindingResolved: true,
        cost: {
          status: "passed",
          currency: "USD",
          baselineSha256: "baseline-digest",
          proposedSha256: "proposed-digest",
        },
      },
    });
    expect(attestation.repairReceipt.sha256).toHaveLength(64);
    expect(() =>
      verifyFinalAttestation(attestation, {
        [values.signer.keyId]: values.signer.publicKey!,
      }),
    ).not.toThrow();
  });

  it("rejects changes to a recorded human decision", () => {
    const values = fixture();
    const attestation = createFinalAttestation({
      ...values,
      repairReceipt: values.receipt,
    });
    attestation.decision.reason = "Altered reason.";

    expect(() =>
      verifyFinalAttestation(attestation, {
        [values.signer.keyId]: values.signer.publicKey!,
      }),
    ).toThrow("signature is invalid");
  });
});

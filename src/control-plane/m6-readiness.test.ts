import { describe, expect, it } from "vitest";
import { evaluateM6Readiness, type M6EvidenceV1 } from "./m6-readiness.js";

function evidence(): M6EvidenceV1 {
  return {
    version: 1,
    deployment: {
      releaseSha: "a".repeat(40),
      controlPlaneImage: "ghcr.io/acme/control@sha256:" + "b".repeat(64),
      runnerImage: "ghcr.io/acme/runner@sha256:" + "c".repeat(64),
      deployedAt: "2026-08-25T10:00:00.000Z",
      rolledBackAt: "2026-08-25T10:15:00.000Z",
      protectedReviewer: "release-owner",
    },
    databaseRecovery: {
      provider: "managed-postgres",
      recoveryPoint: "2026-08-25T09:55:00.000Z",
      restoredAt: "2026-08-25T10:20:00.000Z",
      recoveryTimeSeconds: 240,
      integrityChecksPassed: true,
    },
    monitoring: {
      verifiedAt: "2026-08-25T10:30:00.000Z",
      dashboardUrl: "https://monitoring.example/dashboard/m6",
      incidentRunbookExercised: true,
      deliveredAlerts: ["readiness", "worker-heartbeat", "deployment"],
    },
    securityReview: {
      reviewer: "Independent Reviewer",
      organization: "Security Company",
      completedAt: "2026-08-25T11:00:00.000Z",
      reportUrl: "https://security.example/reports/m6",
      unresolvedCritical: 0,
      unresolvedHigh: 0,
    },
  };
}

describe("M6 readiness evidence", () => {
  it("accepts complete external evidence", () => {
    const report = evaluateM6Readiness(evidence());
    expect(report.ready).toBe(true);
    expect(report.checks.find(({ id }) => id === "security.external_review"))
      .toMatchObject({ passed: true });
  });

  it("fails closed for missing evidence or unresolved high findings", () => {
    const incomplete = evidence();
    incomplete.securityReview.unresolvedHigh = 1;
    incomplete.monitoring.deliveredAlerts = ["readiness"];
    const report = evaluateM6Readiness(incomplete);
    expect(report.ready).toBe(false);
    expect(report.checks.filter(({ passed }) => !passed).map(({ id }) => id))
      .toEqual(["monitoring.alert_delivery", "security.external_review"]);
    expect(evaluateM6Readiness({ version: 1 }).ready).toBe(false);
  });
});

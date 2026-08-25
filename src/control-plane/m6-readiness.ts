export interface M6EvidenceV1 {
  version: 1;
  deployment: {
    releaseSha: string;
    controlPlaneImage: string;
    runnerImage: string;
    deployedAt: string;
    rolledBackAt: string;
    protectedReviewer: string;
  };
  databaseRecovery: {
    provider: string;
    recoveryPoint: string;
    restoredAt: string;
    recoveryTimeSeconds: number;
    integrityChecksPassed: boolean;
  };
  monitoring: {
    verifiedAt: string;
    dashboardUrl: string;
    incidentRunbookExercised: boolean;
    deliveredAlerts: string[];
  };
  securityReview: {
    reviewer: string;
    organization: string;
    completedAt: string;
    reportUrl: string;
    unresolvedCritical: number;
    unresolvedHigh: number;
  };
}

export interface M6ReadinessReport {
  ready: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: unknown): boolean {
  return present(value) && Number.isFinite(Date.parse(String(value)));
}

function digestImage(value: unknown): boolean {
  return present(value) && /@sha256:[0-9a-f]{64}$/.test(String(value));
}

export function evaluateM6Readiness(value: unknown): M6ReadinessReport {
  const evidence = value as Partial<M6EvidenceV1> | undefined;
  const deployment = evidence?.deployment;
  const database = evidence?.databaseRecovery;
  const monitoring = evidence?.monitoring;
  const review = evidence?.securityReview;
  const checks = [
    {
      id: "evidence.version",
      passed: evidence?.version === 1,
      detail: "Evidence document uses version 1.",
    },
    {
      id: "deployment.staging",
      passed: Boolean(
        deployment &&
        /^[0-9a-f]{40}$/.test(deployment.releaseSha) &&
        digestImage(deployment.controlPlaneImage) &&
        digestImage(deployment.runnerImage) &&
        timestamp(deployment.deployedAt) &&
        timestamp(deployment.rolledBackAt) &&
        present(deployment.protectedReviewer),
      ),
      detail: "Protected staging deploy and rollback identify one immutable release pair.",
    },
    {
      id: "database.managed_restore",
      passed: Boolean(
        database &&
        present(database.provider) &&
        timestamp(database.recoveryPoint) &&
        timestamp(database.restoredAt) &&
        Number.isFinite(database.recoveryTimeSeconds) &&
        database.recoveryTimeSeconds > 0 &&
        database.integrityChecksPassed === true,
      ),
      detail: "Managed PostgreSQL recovery records its point, duration, and integrity result.",
    },
    {
      id: "monitoring.alert_delivery",
      passed: Boolean(
        monitoring &&
        timestamp(monitoring.verifiedAt) &&
        /^https:\/\//.test(monitoring.dashboardUrl) &&
        monitoring.incidentRunbookExercised === true &&
        Array.isArray(monitoring.deliveredAlerts) &&
        monitoring.deliveredAlerts.length >= 3 &&
        monitoring.deliveredAlerts.every(present),
      ),
      detail: "Monitoring has a dashboard, at least three delivered alert classes, and a runbook exercise.",
    },
    {
      id: "security.external_review",
      passed: Boolean(
        review &&
        present(review.reviewer) &&
        present(review.organization) &&
        timestamp(review.completedAt) &&
        /^https:\/\//.test(review.reportUrl) &&
        review.unresolvedCritical === 0 &&
        review.unresolvedHigh === 0,
      ),
      detail: "Independent review is complete with no unresolved critical or high findings.",
    },
  ];
  return { ready: checks.every(({ passed }) => passed), checks };
}

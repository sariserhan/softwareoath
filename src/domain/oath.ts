import { parse } from "yaml";

import type {
  EvidenceStatus,
  OathReport,
  OathRule,
  RepairRun,
  RuleEvaluation,
  SoftwareOath,
} from "./types";

const severities = new Set(["critical", "high", "medium", "low"]);
const evidenceKinds = new Set(["command", "test", "review"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function parseRule(value: unknown, index: number): OathRule {
  if (!isRecord(value)) throw new Error(`rules[${index}] must be an object`);
  assertString(value.id, `rules[${index}].id`);
  assertString(value.title, `rules[${index}].title`);
  assertString(value.description, `rules[${index}].description`);
  if (!severities.has(String(value.severity))) {
    throw new Error(`rules[${index}].severity is invalid`);
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new Error(`rules[${index}].evidence must contain at least one check`);
  }

  const evidence = value.evidence.map((entry, evidenceIndex) => {
    if (!isRecord(entry)) {
      throw new Error(`rules[${index}].evidence[${evidenceIndex}] must be an object`);
    }
    if (!evidenceKinds.has(String(entry.kind))) {
      throw new Error(`rules[${index}].evidence[${evidenceIndex}].kind is invalid`);
    }
    if (entry.kind === "command") {
      assertString(entry.command, `rules[${index}].evidence[${evidenceIndex}].command`);
    }
    if (entry.kind === "test" && entry.command === undefined) {
      assertString(entry.path, `rules[${index}].evidence[${evidenceIndex}].path`);
    }
    if (
      entry.timeoutMs !== undefined &&
      (!Number.isInteger(entry.timeoutMs) || Number(entry.timeoutMs) <= 0)
    ) {
      throw new Error(
        `rules[${index}].evidence[${evidenceIndex}].timeoutMs must be a positive integer`,
      );
    }
    return {
      kind: entry.kind as "command" | "test" | "review",
      command: typeof entry.command === "string" ? entry.command : undefined,
      path: typeof entry.path === "string" ? entry.path : undefined,
      required: entry.required !== false,
      timeoutMs:
        typeof entry.timeoutMs === "number" ? entry.timeoutMs : undefined,
    };
  });
  let repair: OathRule["repair"];
  if (value.repair !== undefined) {
    if (!isRecord(value.repair)) {
      throw new Error(`rules[${index}].repair must be an object`);
    }
    if (
      !Array.isArray(value.repair.allowedPaths) ||
      value.repair.allowedPaths.length === 0
    ) {
      throw new Error(
        `rules[${index}].repair.allowedPaths must contain at least one path`,
      );
    }
    const allowedPaths = value.repair.allowedPaths.map((path, pathIndex) => {
      assertString(path, `rules[${index}].repair.allowedPaths[${pathIndex}]`);
      if (path.startsWith("/") || path.includes("..")) {
        throw new Error(
          `rules[${index}].repair.allowedPaths[${pathIndex}] must be repository-relative`,
        );
      }
      return path;
    });
    repair = {
      allowedPaths,
      automaticCandidate: value.repair.automaticCandidate === true,
    };
  }

  return {
    id: value.id,
    title: value.title,
    description: value.description,
    severity: value.severity as OathRule["severity"],
    evidence,
    repair,
  };
}

export function parseOath(source: string): SoftwareOath {
  const raw: unknown = parse(source);
  if (!isRecord(raw)) throw new Error("oath must be an object");
  if (raw.version !== 1) throw new Error("version must be 1");
  if (!isRecord(raw.application)) throw new Error("application must be an object");
  assertString(raw.application.name, "application.name");
  assertString(raw.application.repository, "application.repository");
  assertString(raw.application.defaultBranch, "application.defaultBranch");
  if (!isRecord(raw.approval)) throw new Error("approval must be an object");
  if (!Array.isArray(raw.approval.requireHumanFor)) {
    throw new Error("approval.requireHumanFor must be an array");
  }
  if (raw.approval.allowAutomaticMerge === true) {
    throw new Error(
      "approval.allowAutomaticMerge must be false; Software Oath never merges pull requests",
    );
  }
  const requireHumanFor = raw.approval.requireHumanFor.map(String);
  if (requireHumanFor.some((severity) => !severities.has(severity))) {
    throw new Error("approval.requireHumanFor contains an invalid severity");
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new Error("rules must contain at least one rule");
  }
  const rules = raw.rules.map(parseRule);
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
    throw new Error("rule ids must be unique");
  }

  let cost: SoftwareOath["cost"];
  if (raw.cost !== undefined) {
    if (!isRecord(raw.cost)) throw new Error("cost must be an object");
    if (raw.cost.enabled !== undefined && typeof raw.cost.enabled !== "boolean") {
      throw new Error("cost.enabled must be a boolean");
    }
    if (
      raw.cost.requireEstimate !== undefined &&
      typeof raw.cost.requireEstimate !== "boolean"
    ) {
      throw new Error("cost.requireEstimate must be a boolean");
    }
    const currency = raw.cost.currency === undefined ? "USD" : raw.cost.currency;
    assertString(currency, "cost.currency");
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("cost.currency must be a three-letter uppercase ISO currency code");
    }
    for (const field of ["maxMonthlyIncrease", "maxPercentageIncrease"] as const) {
      const value = raw.cost[field];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        throw new Error(`cost.${field} must be a non-negative number`);
      }
    }
    cost = {
      enabled: raw.cost.enabled !== false,
      requireEstimate: raw.cost.requireEstimate !== false,
      currency,
      maxMonthlyIncrease:
        typeof raw.cost.maxMonthlyIncrease === "number" ? raw.cost.maxMonthlyIncrease : undefined,
      maxPercentageIncrease:
        typeof raw.cost.maxPercentageIncrease === "number" ? raw.cost.maxPercentageIncrease : undefined,
    };
  }

  return {
    version: 1,
    application: {
      name: raw.application.name,
      repository: raw.application.repository,
      defaultBranch: raw.application.defaultBranch,
    },
    approval: {
      requireHumanFor: requireHumanFor as OathRule["severity"][],
      allowAutomaticMerge: false,
    },
    cost,
    rules,
  };
}

function evaluateRule(rule: OathRule, run: RepairRun): RuleEvaluation {
  const evidence = run.evidence.filter((record) => record.ruleId === rule.id);
  const requiredKinds = rule.evidence
    .filter((requirement) => requirement.required)
    .map((requirement) => requirement.kind);
  const missing = requiredKinds.filter(
    (kind) => !evidence.some((record) => record.kind === kind),
  );

  let status: EvidenceStatus;
  let reason: string;
  if (evidence.some((record) => record.status === "failed")) {
    status = "failed";
    reason = "At least one required check failed.";
  } else if (
    missing.length > 0 ||
    evidence.some((record) => record.status === "human_review")
  ) {
    status = "human_review";
    reason =
      missing.length > 0
        ? `Missing required evidence: ${missing.join(", ")}.`
        : "A reviewer must resolve the remaining judgment.";
  } else {
    status = "passed";
    reason = "All required evidence passed.";
  }

  return { rule, status, evidence, reason };
}

export function evaluateOath(
  oath: SoftwareOath,
  run: RepairRun,
  generatedAt = new Date().toISOString(),
): OathReport {
  const rules = oath.rules.map((rule) => evaluateRule(rule, run));
  const summary = {
    passed: rules.filter((result) => result.status === "passed").length,
    failed: rules.filter((result) => result.status === "failed").length,
    humanReview: rules.filter((result) => result.status === "human_review").length,
  };
  const humanReviewRequired = rules.some(
    ({ rule, status }) =>
      status === "human_review" ||
      (status === "passed" &&
        oath.approval.requireHumanFor.includes(rule.severity)),
  );

  return {
    runId: run.id,
    application: oath.application.name,
    decision:
      summary.failed > 0
        ? "blocked"
        : humanReviewRequired
          ? "review_required"
          : "ready",
    generatedAt,
    summary,
    rules,
  };
}

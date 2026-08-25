import type {
  MigrationEffortInputV1,
  MigrationEstimateV1,
  OperationalComplexityAssessmentV1,
  PriceRangeV1,
} from "./types.js";

export interface OperationalComplexityInputV1 {
  version: 1;
  targetServiceId: "ses" | "postmark";
  deliveryEventsRequired: boolean;
  inboundEmailRequired: boolean;
  dedicatedIpRequired: boolean;
  multipleRegionsRequired: boolean;
  ownerHourlyCost: number;
}

function range(minimum: number, likely: number, maximum: number): PriceRangeV1 {
  const round = (value: number) => Math.round(value * 100) / 100;
  return { minimum: round(minimum), likely: round(likely), maximum: round(maximum) };
}

function validateCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

function validateHourlyCost(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Owner hourly cost must be a positive finite number.");
  }
}

export function assessOperationalComplexity(
  input: OperationalComplexityInputV1,
): OperationalComplexityAssessmentV1 {
  validateHourlyCost(input.ownerHourlyCost);
  let score = input.targetServiceId === "ses" ? 2 : 0;
  const reasons: string[] = input.targetServiceId === "ses"
    ? ["SES shifts more deliverability, identity, quota, and event-destination operations to the owner."]
    : [];
  const add = (condition: boolean, points: number, reason: string) => {
    if (!condition) return;
    score += points;
    reasons.push(reason);
  };
  add(input.deliveryEventsRequired, 1, "Delivery event destinations and retries require ongoing ownership.");
  add(input.inboundEmailRequired, 2, "Inbound routing and processing add operational state.");
  add(input.dedicatedIpRequired, 2, "Dedicated IP allocation, warming, and reputation require operations.");
  add(input.multipleRegionsRequired, 2, "Multiple regions multiply identity, routing, and monitoring work.");
  const level = score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  const annualHours = range(score * 8, score * 16, score * 28);
  return {
    version: 1,
    level,
    annualCost: range(
      annualHours.minimum * input.ownerHourlyCost,
      annualHours.likely * input.ownerHourlyCost,
      annualHours.maximum * input.ownerHourlyCost,
    ),
    reasons: reasons.length ? reasons : ["No material incremental operational drivers were selected."],
  };
}

export function estimateMigrationEffort(options: {
  input: MigrationEffortInputV1;
  operationalComplexity: OperationalComplexityAssessmentV1;
}): MigrationEstimateV1 {
  const input = options.input;
  validateHourlyCost(input.ownerHourlyCost);
  for (const [name, value] of Object.entries({
    affectedFiles: input.affectedFiles,
    changedCapabilities: input.changedCapabilities,
    configurationChanges: input.configurationChanges,
    dnsChanges: input.dnsChanges,
    infrastructureChanges: input.infrastructureChanges,
  })) validateCount(value, name);

  let hours = range(4, 6, 10);
  const drivers: string[] = ["Base provider adapter and verification work."];
  const add = (driver: string, values: PriceRangeV1) => {
    hours = range(
      hours.minimum + values.minimum,
      hours.likely + values.likely,
      hours.maximum + values.maximum,
    );
    drivers.push(driver);
  };
  add(`${input.affectedFiles} affected file(s).`, range(
    input.affectedFiles * 0.5,
    input.affectedFiles,
    input.affectedFiles * 1.5,
  ));
  add(`${input.changedCapabilities} changed API capability/capabilities.`, range(
    input.changedCapabilities,
    input.changedCapabilities * 2,
    input.changedCapabilities * 4,
  ));
  add(`${input.configurationChanges} configuration change(s).`, range(
    input.configurationChanges * 0.5,
    input.configurationChanges,
    input.configurationChanges * 2,
  ));
  add(`${input.dnsChanges} DNS change(s).`, range(
    input.dnsChanges,
    input.dnsChanges * 2,
    input.dnsChanges * 4,
  ));
  add(`${input.infrastructureChanges} infrastructure change(s).`, range(
    input.infrastructureChanges * 2,
    input.infrastructureChanges * 4,
    input.infrastructureChanges * 8,
  ));
  const data = input.dataMovement === "none" ? range(0, 0, 0)
    : input.dataMovement === "bounded" ? range(2, 4, 8) : range(8, 20, 40);
  add(`${input.dataMovement} data movement.`, data);
  const testing = input.testingScope === "focused" ? range(2, 4, 6)
    : input.testingScope === "integration" ? range(4, 8, 14) : range(8, 16, 28);
  add(`${input.testingScope} testing.`, testing);
  const rollout = input.rolloutComplexity === "simple" ? range(1, 2, 4)
    : input.rolloutComplexity === "staged" ? range(3, 6, 10) : range(6, 12, 20);
  add(`${input.rolloutComplexity} rollout.`, rollout);
  const rollback = input.rollbackComplexity === "simple" ? range(1, 2, 4)
    : range(4, 8, 16);
  add(`${input.rollbackComplexity} rollback.`, rollback);

  const engineeringCost = range(
    hours.minimum * input.ownerHourlyCost,
    hours.likely * input.ownerHourlyCost,
    hours.maximum * input.ownerHourlyCost,
  );
  return {
    engineeringHours: hours,
    engineeringCost,
    operationalCostChangeAnnual: options.operationalComplexity.annualCost,
    riskAllowance: range(
      engineeringCost.minimum * 0.1,
      engineeringCost.likely * 0.2,
      engineeringCost.maximum * 0.35,
    ),
    effortDrivers: drivers,
    operationalComplexity: options.operationalComplexity,
  };
}

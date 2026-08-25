import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { CostPolicy } from "../domain/types.js";

export const INFRACOST_VERSION = "0.10.45";

export interface InfracostScanResult {
  output: string;
  durationMs: number;
  runner: string;
}

export interface InfracostScanner {
  scan(workspacePath: string, currency: string): Promise<InfracostScanResult>;
}

export interface RemoteInfracostScannerOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

export class RemoteInfracostScanner implements InfracostScanner {
  constructor(private readonly options: RemoteInfracostScannerOptions) {
    if (!options.baseUrl.trim() || !options.token.trim()) {
      throw new Error("Runner broker URL and token are required for Infracost.");
    }
  }

  async scan(workspacePath: string, currency: string): Promise<InfracostScanResult> {
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid cost currency.");
    const response = await fetch(
      `${this.options.baseUrl.replace(/\/$/, "")}/cost-analysis`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspacePath, currency }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5 * 60_000),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Infracost runner failed with ${response.status}: ${detail.slice(0, 500)}`);
    }
    const result = (await response.json()) as Partial<InfracostScanResult>;
    if (
      typeof result.output !== "string" ||
      typeof result.durationMs !== "number" ||
      typeof result.runner !== "string"
    ) {
      throw new Error("Infracost runner returned an invalid result.");
    }
    return result as InfracostScanResult;
  }
}

export interface NormalizedCostEstimate {
  monthlyCost: number;
  currency: string;
  projects: number;
  resources: number;
  unsupportedResources: string[];
}

export interface CostAnalysisEvidence {
  provider: "infracost";
  version: string;
  status: "not_applicable" | "passed" | "review_required" | "blocked";
  currency: string;
  baselineMonthlyCost?: number;
  proposedMonthlyCost?: number;
  monthlyCostChange?: number;
  percentageChange?: number;
  projects: number;
  resources: number;
  unsupportedResources: string[];
  detectedFiles: string[];
  reasons: string[];
  policy: CostPolicy;
  runner?: string;
  durationMs: number;
  artifacts?: {
    baselinePath: string;
    proposedPath: string;
    baselineSha256: string;
    proposedSha256: string;
  };
}

async function walk(root: string, directory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".terraform", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, path, files);
    } else if (entry.isFile()) {
      const relativePath = relative(root, path).replaceAll("\\", "/");
      if (relativePath.endsWith(".tf") || relativePath.endsWith(".tf.json") || relativePath.endsWith("terragrunt.hcl")) {
        files.push(relativePath);
      } else if (/\.(?:ya?ml|json)$/.test(relativePath)) {
        const source = await readFile(path, "utf8").catch(() => "");
        if (/AWSTemplateFormatVersion|AWS::[A-Za-z0-9:]+/.test(source)) files.push(relativePath);
      }
    }
  }
}

export async function detectInfrastructureAsCode(repositoryPath: string): Promise<string[]> {
  const files: string[] = [];
  await walk(repositoryPath, repositoryPath, files);
  return files.sort();
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function resourcesIn(project: Record<string, unknown>): unknown[] {
  if (Array.isArray(project.resources)) return project.resources;
  const breakdown = project.breakdown;
  if (breakdown && typeof breakdown === "object" && Array.isArray((breakdown as Record<string, unknown>).resources)) {
    return (breakdown as Record<string, unknown>).resources as unknown[];
  }
  return [];
}

export function normalizeInfracostOutput(output: string, expectedCurrency: string): NormalizedCostEstimate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Infracost returned invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Infracost returned an invalid result.");
  const document = parsed as Record<string, unknown>;
  const projects = Array.isArray(document.projects)
    ? document.projects.filter((project): project is Record<string, unknown> => Boolean(project) && typeof project === "object")
    : [];
  const projectTotal = projects.reduce((sum, project) => sum + (numeric(project.totalMonthlyCost) ?? 0), 0);
  const monthlyCost = numeric(document.totalMonthlyCost) ?? numeric(document.monthlyCost) ?? (projects.length ? projectTotal : undefined);
  if (monthlyCost === undefined) throw new Error("Infracost output did not contain a monthly cost estimate.");
  const resources = projects.flatMap(resourcesIn);
  const summary = document.summary && typeof document.summary === "object"
    ? document.summary as Record<string, unknown>
    : {};
  const unsupportedCounts = summary.unsupportedResourceCounts;
  const unsupported = Array.isArray(document.unsupportedResources)
    ? document.unsupportedResources.map(String)
    : unsupportedCounts && typeof unsupportedCounts === "object"
      ? Object.keys(unsupportedCounts)
      : projects.flatMap((project) => Array.isArray(project.unsupportedResources) ? project.unsupportedResources.map(String) : []);
  return {
    monthlyCost,
    currency: typeof document.currency === "string" ? document.currency : expectedCurrency,
    projects: projects.length || Number(document.projectCount ?? 0),
    resources: (numeric(summary.totalDetectedResources) ?? resources.length) || Number(document.resourceCount ?? 0),
    unsupportedResources: [...new Set(unsupported)].sort(),
  };
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function evaluateCostChange(options: {
  policy: CostPolicy;
  detectedFiles: string[];
  baseline?: NormalizedCostEstimate;
  proposed?: NormalizedCostEstimate;
  baselineScan?: InfracostScanResult;
  proposedScan?: InfracostScanResult;
  baselinePath?: string;
  proposedPath?: string;
  error?: string;
}): CostAnalysisEvidence {
  const { policy, detectedFiles, baseline, proposed, baselineScan, proposedScan } = options;
  if (!detectedFiles.length) return {
    provider: "infracost", version: INFRACOST_VERSION, status: "not_applicable",
    currency: policy.currency, projects: 0, resources: 0, unsupportedResources: [],
    detectedFiles, reasons: ["No supported infrastructure-as-code files were detected."],
    policy, durationMs: 0,
  };
  if (!baseline || !proposed || !baselineScan || !proposedScan || !options.baselinePath || !options.proposedPath) {
    return {
      provider: "infracost", version: INFRACOST_VERSION,
      status: policy.requireEstimate ? "blocked" : "review_required",
      currency: policy.currency, projects: 0, resources: 0, unsupportedResources: [],
      detectedFiles, reasons: [options.error ?? "Required cost estimate is unavailable."],
      policy, durationMs: (baselineScan?.durationMs ?? 0) + (proposedScan?.durationMs ?? 0),
    };
  }
  const change = rounded(proposed.monthlyCost - baseline.monthlyCost);
  const percentage = baseline.monthlyCost === 0
    ? proposed.monthlyCost === 0 ? 0 : 100
    : rounded((change / baseline.monthlyCost) * 100);
  const reasons: string[] = [];
  if (policy.maxMonthlyIncrease !== undefined && change > policy.maxMonthlyIncrease) {
    reasons.push(`Monthly cost increase ${change} ${policy.currency} exceeds the ${policy.maxMonthlyIncrease} ${policy.currency} limit.`);
  }
  if (policy.maxPercentageIncrease !== undefined && percentage > policy.maxPercentageIncrease) {
    reasons.push(`Monthly cost increase ${percentage}% exceeds the ${policy.maxPercentageIncrease}% limit.`);
  }
  if (proposed.currency !== policy.currency || baseline.currency !== policy.currency) {
    reasons.push(`Estimate currency does not match required ${policy.currency}.`);
  }
  let blocked = reasons.length > 0;
  if (proposed.unsupportedResources.length) {
    reasons.push(`Infracost could not price ${proposed.unsupportedResources.length} resource type(s).`);
    blocked ||= policy.requireEstimate;
  }
  const reviewRequired = change > 0 || proposed.unsupportedResources.length > 0;
  return {
    provider: "infracost", version: INFRACOST_VERSION,
    status: blocked ? "blocked" : reviewRequired ? "review_required" : "passed",
    currency: policy.currency,
    baselineMonthlyCost: rounded(baseline.monthlyCost),
    proposedMonthlyCost: rounded(proposed.monthlyCost),
    monthlyCostChange: change,
    percentageChange: percentage,
    projects: proposed.projects,
    resources: proposed.resources,
    unsupportedResources: proposed.unsupportedResources,
    detectedFiles, reasons: reasons.length ? reasons : [change > 0 ? "Cost increase requires owner review." : "Cost policy passed."],
    policy,
    runner: proposedScan.runner,
    durationMs: baselineScan.durationMs + proposedScan.durationMs,
    artifacts: {
      baselinePath: options.baselinePath,
      proposedPath: options.proposedPath,
      baselineSha256: createHash("sha256").update(baselineScan.output).digest("hex"),
      proposedSha256: createHash("sha256").update(proposedScan.output).digest("hex"),
    },
  };
}

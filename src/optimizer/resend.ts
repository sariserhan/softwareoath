import { dirname, join, normalize } from "node:path";

import type {
  CapabilityEvidenceV1,
  OptimizerSignalV1,
  ServiceObservationV1,
  SourceEvidenceV1,
} from "./types";

export interface ResendDetectionV1 {
  version: 1;
  observation?: ServiceObservationV1;
  capabilities: CapabilityEvidenceV1[];
  unknowns: string[];
}

const ignoredSegments = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "examples",
  "example",
  "fixtures",
  "__fixtures__",
  "__tests__",
  "generated",
  "__generated__",
]);

export function isOptimizerSourcePath(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => ignoredSegments.has(segment.toLowerCase()))) {
    return false;
  }
  const name = segments.at(-1) ?? "";
  return !(
    /\.(?:test|spec|mock)\.[cm]?[jt]sx?$/.test(name) ||
    name.startsWith("mock.")
  );
}
function maskComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (value, prefix: string) =>
      prefix + " ".repeat(value.length - prefix.length));
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function localImportTargets(path: string, source: string): string[] {
  const directory = dirname(path);
  const targets: string[] = [];
  for (const match of source.matchAll(
    /(?:import[\s\S]*?\sfrom\s*|require\s*\()\s*["'](\.[^"']+)["']/g,
  )) {
    const base = normalize(join(directory, match[1])).replaceAll("\\", "/");
    targets.push(base);
  }
  return targets;
}

function resolveLocalTarget(
  target: string,
  sources: Map<string, string>,
): string | undefined {
  const candidates = [
    target,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map(
      (extension) => target + extension,
    ),
    ...[".ts", ".tsx", ".js", ".jsx"].map(
      (extension) => target + "/index" + extension,
    ),
  ];
  return candidates.find((candidate) => sources.has(candidate));
}

function connectedFiles(
  sources: Map<string, string>,
  directFiles: Set<string>,
): Set<string> {
  const connected = new Set(directFiles);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [path, source] of sources) {
      if (connected.has(path)) continue;
      const importsConnectedFile = localImportTargets(path, source).some((target) => {
        const resolved = resolveLocalTarget(target, sources);
        return Boolean(resolved && connected.has(resolved));
      });
      if (importsConnectedFile) {
        connected.add(path);
        changed = true;
      }
    }
  }
  return connected;
}

function capabilityEvidence(options: {
  capabilityId: string;
  path: string;
  source: string;
  offset: number;
  confidence?: SourceEvidenceV1["confidence"];
  provenance?: SourceEvidenceV1["provenance"];
  reason: string;
}): CapabilityEvidenceV1 {
  return {
    version: 1,
    serviceId: "resend",
    capabilityId: options.capabilityId,
    requirement: "required",
    confidence: options.confidence ?? "high",
    ownerConfirmed: false,
    evidence: [{
      version: 1,
      provenance: options.provenance ?? "observed",
      confidence: options.confidence ?? "high",
      file: options.path,
      lineStart: lineAt(options.source, options.offset),
      reason: options.reason,
    }],
  };
}

function capabilitiesForFile(
  path: string,
  source: string,
  connected: boolean,
  hasResendManifest: boolean,
): CapabilityEvidenceV1[] {
  const patterns: Array<{
    id: string;
    expression: RegExp;
    reason: string;
    requiresConnection: boolean;
  }> = [
    {
      id: "transactional_send",
      expression: /\.emails\.send\s*\(/,
      reason: "A Resend-connected runtime path sends an individual email.",
      requiresConnection: true,
    },
    {
      id: "batch_send",
      expression: /\.batch\.send\s*\(/,
      reason: "A Resend-connected runtime path invokes provider-side batch sending.",
      requiresConnection: true,
    },
    {
      id: "html_email",
      expression: /\bhtml\s*:/,
      reason: "A Resend-connected message supplies an HTML body.",
      requiresConnection: true,
    },
    {
      id: "html_email",
      expression: /\b(?:payload\.)?react\b/,
      reason: "A Resend-connected message supplies a React Email body.",
      requiresConnection: true,
    },
    {
      id: "text_email",
      expression: /\btext\s*:/,
      reason: "A Resend-connected message supplies a text body.",
      requiresConnection: true,
    },
    {
      id: "attachments",
      expression: /\battachments\s*:/,
      reason: "A Resend-connected message supplies attachments.",
      requiresConnection: true,
    },
    {
      id: "provider_templates",
      expression: /\btemplate\s*:/,
      reason: "A Resend-connected message depends on a provider-hosted template.",
      requiresConnection: true,
    },
    {
      id: "scheduled_send",
      expression: /\bscheduledAt\s*:/,
      reason: "A Resend-connected message uses provider-side scheduling.",
      requiresConnection: true,
    },
    {
      id: "delivery_webhooks",
      expression: /["']email\.(?:delivered|bounced|complained|opened|clicked)["']/,
      reason: "Tracked runtime code handles a Resend delivery webhook event.",
      requiresConnection: false,
    },
    {
      id: "inbound_email",
      expression: /["']email\.received["']/,
      reason: "Tracked runtime code handles Resend inbound email.",
      requiresConnection: false,
    },
  ];
  return patterns.flatMap((pattern) => {
    if (pattern.requiresConnection ? !connected : !hasResendManifest) return [];
    const match = pattern.expression.exec(source);
    if (!match) return [];
    return [capabilityEvidence({
      capabilityId: pattern.id,
      path,
      source,
      offset: match.index,
      confidence: connected ? "very_high" : "high",
      reason: pattern.reason,
    })];
  });
}

function mergeCapabilities(
  capabilities: CapabilityEvidenceV1[],
): CapabilityEvidenceV1[] {
  const grouped = new Map<string, CapabilityEvidenceV1>();
  for (const capability of capabilities) {
    const existing = grouped.get(capability.capabilityId);
    if (existing) {
      existing.evidence.push(...capability.evidence);
    } else {
      grouped.set(capability.capabilityId, {
        ...capability,
        evidence: [...capability.evidence],
      });
    }
  }
  return [...grouped.values()].sort((a, b) =>
    a.capabilityId.localeCompare(b.capabilityId));
}

export function detectResend(options: {
  commit: string;
  signals: OptimizerSignalV1[];
  sources: Map<string, string>;
}): ResendDetectionV1 {
  const sources = new Map(
    [...options.sources]
      .filter(([path]) => isOptimizerSourcePath(path))
      .map(([path, source]) => [path, maskComments(source)]),
  );
  const relevantSignals = options.signals.filter((signal) =>
    isOptimizerSourcePath(signal.evidence.file) &&
    (
      (signal.kind === "manifest_dependency" && signal.value === "resend") ||
      (signal.kind === "active_import" &&
        (signal.value === "resend" || signal.value.startsWith("resend/"))) ||
      (signal.kind === "environment_name" && signal.value === "RESEND_API_KEY") ||
      (signal.kind === "api_hostname" && signal.value === "api.resend.com")
    ));
  if (!relevantSignals.length) {
    return { version: 1, capabilities: [], unknowns: [] };
  }

  const hasManifest = relevantSignals.some(
    (signal) => signal.kind === "manifest_dependency",
  );
  const directFiles = new Set(
    relevantSignals
      .filter((signal) =>
        signal.kind === "active_import" || signal.kind === "api_hostname")
      .map((signal) => signal.evidence.file),
  );
  const connected = connectedFiles(sources, directFiles);
  const capabilities = mergeCapabilities(
    [...sources].flatMap(([path, source]) =>
      capabilitiesForFile(path, source, connected.has(path), hasManifest)),
  );
  const hasInitialization = [...directFiles].some((path) =>
    /\bnew\s+Resend\s*\(/.test(sources.get(path) ?? ""));
  const hasApiEndpoint = relevantSignals.some(
    (signal) => signal.kind === "api_hostname",
  );
  const active =
    hasInitialization || hasApiEndpoint ||
    capabilities.some((capability) =>
      ["transactional_send", "batch_send", "delivery_webhooks", "inbound_email"]
        .includes(capability.capabilityId));
  const ambiguous =
    !active && relevantSignals.some((signal) =>
      signal.kind === "environment_name" || signal.kind === "active_import");
  const status: ServiceObservationV1["status"] =
    active ? "active" : ambiguous ? "ambiguous" : "inactive";
  const confidence: ServiceObservationV1["confidence"] =
    active ? "very_high" : ambiguous ? "medium" : "medium";
  const evidence = relevantSignals.map((signal) => signal.evidence);
  const unknowns =
    status === "ambiguous"
      ? [
          "Resend configuration or imports were observed, but active runtime use " +
          "was not corroborated.",
        ]
      : status === "inactive"
        ? ["The Resend package is declared, but active runtime use was not observed."]
        : [];

  return {
    version: 1,
    observation: {
      version: 1,
      serviceId: "resend",
      category: "transactional_email",
      status,
      confidence,
      evidence,
      analyzedCommit: options.commit,
    },
    capabilities,
    unknowns,
  };
}

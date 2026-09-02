import type {
  EvidenceConfidence,
  OptimizerAnalysisRecordV1,
  OptimizerSignalV1,
  SourceEvidenceV1,
} from "./types.js";

export type DependencyNodeKind =
  | "service"
  | "capability"
  | "file"
  | "package"
  | "configuration"
  | "infrastructure";

export interface DependencyGraphNodeV1 {
  id: string;
  kind: DependencyNodeKind;
  label: string;
  detail: string;
  confidence: EvidenceConfidence;
  evidence: SourceEvidenceV1[];
}

export interface DependencyGraphEdgeV1 {
  id: string;
  from: string;
  to: string;
  relationship: "requires" | "imports" | "configures" | "declares" | "invokes";
  evidence: SourceEvidenceV1[];
}

export interface DependencyGraphV1 {
  version: 1;
  commit: string;
  nodes: DependencyGraphNodeV1[];
  edges: DependencyGraphEdgeV1[];
}

export interface RemovalImpactV1 {
  serviceId: string;
  level: "low" | "medium" | "high";
  directNodeIds: string[];
  indirectNodeIds: string[];
  affectedNodeIds: string[];
  affectedFiles: string[];
  capabilities: string[];
  configuration: string[];
  whatBreaks: string[];
  checklist: string[];
}

const confidenceRank: Record<EvidenceConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
  very_high: 3,
};

function strongestConfidence(evidence: SourceEvidenceV1[]): EvidenceConfidence {
  let strongest: EvidenceConfidence = "low";
  for (const item of evidence) {
    if (confidenceRank[item.confidence] > confidenceRank[strongest]) {
      strongest = item.confidence;
    }
  }
  return strongest;
}

function evidenceKey(evidence: SourceEvidenceV1): string {
  return [evidence.file, evidence.lineStart ?? 0, evidence.reason].join(":");
}

function nodeId(kind: DependencyNodeKind, value: string): string {
  return `${kind}:${value}`;
}

function displayLabel(value: string): string {
  return value.replace(/^@/, "").replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function signalRelationship(signal: OptimizerSignalV1): DependencyGraphEdgeV1["relationship"] {
  if (signal.kind === "active_import" || signal.kind === "manifest_dependency") return "imports";
  if (signal.kind === "environment_name") return "configures";
  if (signal.kind === "infrastructure_declaration") return "declares";
  return "invokes";
}

function signalKind(signal: OptimizerSignalV1): DependencyNodeKind | undefined {
  if (signal.kind === "active_import" || signal.kind === "manifest_dependency") return "package";
  if (signal.kind === "environment_name") return "configuration";
  if (signal.kind === "infrastructure_declaration") return "infrastructure";
  return undefined;
}

function signalMatchesEvidence(signal: OptimizerSignalV1, evidenceKeys: Set<string>): boolean {
  return evidenceKeys.has(evidenceKey(signal.evidence));
}

export function buildDependencyGraph(analysis: OptimizerAnalysisRecordV1): DependencyGraphV1 {
  const nodes = new Map<string, DependencyGraphNodeV1>();
  const edges = new Map<string, DependencyGraphEdgeV1>();

  function upsertNode(node: DependencyGraphNodeV1) {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    const evidence = [...existing.evidence, ...node.evidence].filter((item, index, items) =>
      items.findIndex((candidate) => evidenceKey(candidate) === evidenceKey(item)) === index);
    nodes.set(node.id, { ...existing, evidence, confidence: strongestConfidence(evidence) });
  }

  function upsertEdge(edge: Omit<DependencyGraphEdgeV1, "id">) {
    if (edge.from === edge.to) return;
    const id = `${edge.from}->${edge.to}:${edge.relationship}`;
    const existing = edges.get(id);
    edges.set(id, existing
      ? { ...existing, evidence: [...existing.evidence, ...edge.evidence] }
      : { ...edge, id });
  }

  for (const observation of analysis.observations) {
    if (observation.status === "inactive") continue;
    const serviceId = nodeId("service", observation.serviceId);
    upsertNode({
      id: serviceId,
      kind: "service",
      label: displayLabel(observation.serviceId),
      detail: displayLabel(observation.category),
      confidence: observation.confidence,
      evidence: observation.evidence,
    });

    const serviceCapabilities = analysis.capabilities.filter((item) => item.serviceId === observation.serviceId);
    for (const capability of serviceCapabilities) {
      const capabilityId = nodeId("capability", `${observation.serviceId}:${capability.capabilityId}`);
      upsertNode({
        id: capabilityId,
        kind: "capability",
        label: displayLabel(capability.capabilityId),
        detail: `${displayLabel(capability.requirement)} capability`,
        confidence: capability.confidence,
        evidence: capability.evidence,
      });
      upsertEdge({ from: capabilityId, to: serviceId, relationship: "requires", evidence: capability.evidence });
      for (const evidence of capability.evidence) {
        const fileId = nodeId("file", evidence.file);
        upsertNode({
          id: fileId,
          kind: "file",
          label: evidence.file.split("/").at(-1) ?? evidence.file,
          detail: evidence.file,
          confidence: evidence.confidence,
          evidence: [evidence],
        });
        upsertEdge({ from: fileId, to: capabilityId, relationship: "invokes", evidence: [evidence] });
      }
    }

    const serviceEvidence = new Set([
      ...observation.evidence,
      ...serviceCapabilities.flatMap((item) => item.evidence),
    ].map(evidenceKey));
    const serviceSignals = analysis.signals.filter((signal) => signalMatchesEvidence(signal, serviceEvidence));
    for (const signal of serviceSignals) {
      const kind = signalKind(signal);
      const fileId = nodeId("file", signal.evidence.file);
      upsertNode({
        id: fileId,
        kind: "file",
        label: signal.evidence.file.split("/").at(-1) ?? signal.evidence.file,
        detail: signal.evidence.file,
        confidence: signal.evidence.confidence,
        evidence: [signal.evidence],
      });
      if (!kind) {
        upsertEdge({ from: fileId, to: serviceId, relationship: signalRelationship(signal), evidence: [signal.evidence] });
        continue;
      }
      const dependencyId = nodeId(kind, `${observation.serviceId}:${signal.value}`);
      upsertNode({
        id: dependencyId,
        kind,
        label: signal.value,
        detail: kind === "configuration" ? "Environment variable" : displayLabel(kind),
        confidence: signal.evidence.confidence,
        evidence: [signal.evidence],
      });
      upsertEdge({ from: dependencyId, to: serviceId, relationship: signalRelationship(signal), evidence: [signal.evidence] });
      upsertEdge({ from: fileId, to: dependencyId, relationship: signalRelationship(signal), evidence: [signal.evidence] });
    }
  }

  return {
    version: 1,
    commit: analysis.commit,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function analyzeRemoval(graph: DependencyGraphV1, serviceId: string): RemovalImpactV1 {
  const targetId = serviceId.startsWith("service:") ? serviceId : nodeId("service", serviceId);
  const incoming = new Map<string, DependencyGraphEdgeV1[]>();
  for (const edge of graph.edges) {
    const current = incoming.get(edge.to) ?? [];
    current.push(edge);
    incoming.set(edge.to, current);
  }

  const distance = new Map<string, number>([[targetId, 0]]);
  const queue = [targetId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const nextDistance = (distance.get(current) ?? 0) + 1;
    for (const edge of incoming.get(current) ?? []) {
      if (distance.has(edge.from)) continue;
      distance.set(edge.from, nextDistance);
      queue.push(edge.from);
    }
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const affected = [...distance.entries()]
    .filter(([id]) => id !== targetId)
    .map(([id, depth]) => ({ node: nodeById.get(id), depth }))
    .filter((item): item is { node: DependencyGraphNodeV1; depth: number } => Boolean(item.node));
  const directNodeIds = affected.filter((item) => item.depth === 1).map((item) => item.node.id);
  const indirectNodeIds = affected.filter((item) => item.depth > 1).map((item) => item.node.id);
  const capabilities = affected.filter((item) => item.node.kind === "capability").map((item) => item.node.label);
  const affectedFiles = affected.filter((item) => item.node.kind === "file").map((item) => item.node.detail);
  const configuration = affected.filter((item) => item.node.kind === "configuration").map((item) => item.node.label);
  const packages = affected.filter((item) => item.node.kind === "package").map((item) => item.node.label);
  const infrastructure = affected.filter((item) => item.node.kind === "infrastructure").map((item) => item.node.label);
  const level = capabilities.length > 0 || affectedFiles.length >= 3
    ? "high"
    : affected.length > 0 ? "medium" : "low";

  const whatBreaks = [
    ...capabilities.slice(0, 4).map((item) => `${item} loses its current provider.`),
    ...affectedFiles.slice(0, Math.max(0, 5 - capabilities.length)).map((item) => `${item} contains affected usage.`),
  ];
  const checklist = [
    ...(capabilities.length ? [`Preserve or replace ${capabilities.length} required ${capabilities.length === 1 ? "capability" : "capabilities"}.`] : []),
    ...(packages.length ? [`Replace or remove ${packages.join(", ")} from runtime manifests and imports.`] : []),
    ...(configuration.length ? [`Update ${configuration.join(", ")} configuration.`] : []),
    ...(infrastructure.length ? [`Migrate ${infrastructure.join(", ")} infrastructure declarations.`] : []),
    ...(affectedFiles.length ? [`Update ${affectedFiles.length} affected ${affectedFiles.length === 1 ? "file" : "files"}.`] : []),
    "Run repository-owned verification for the affected paths.",
    "Re-scan the target commit and confirm no active dependency edges remain.",
  ];

  return {
    serviceId: targetId,
    level,
    directNodeIds,
    indirectNodeIds,
    affectedNodeIds: affected.map((item) => item.node.id),
    affectedFiles: [...new Set(affectedFiles)],
    capabilities: [...new Set(capabilities)],
    configuration: [...new Set(configuration)],
    whatBreaks: whatBreaks.length ? whatBreaks : ["No corroborated runtime breakage was found."],
    checklist,
  };
}

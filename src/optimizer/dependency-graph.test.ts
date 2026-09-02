import { describe, expect, it } from "vitest";

import { analyzeRemoval, buildDependencyGraph } from "./dependency-graph.js";
import type { OptimizerAnalysisRecordV1, SourceEvidenceV1 } from "./types.js";

const runtimeEvidence: SourceEvidenceV1 = {
  version: 1,
  provenance: "observed",
  confidence: "very_high",
  file: "src/email/send.ts",
  lineStart: 18,
  reason: "Executable source invokes this qualified runtime call.",
};
const importEvidence: SourceEvidenceV1 = {
  version: 1,
  provenance: "observed",
  confidence: "high",
  file: "src/email/send.ts",
  lineStart: 2,
  reason: "Executable source imports this external package.",
};
const environmentEvidence: SourceEvidenceV1 = {
  version: 1,
  provenance: "observed",
  confidence: "medium",
  file: "src/email/send.ts",
  lineStart: 7,
  reason: "Executable source references this environment-variable name; its value was not read.",
};

const analysis: OptimizerAnalysisRecordV1 = {
  version: 1,
  id: "analysis-1",
  tenantKey: "tenant-1",
  repositoryId: "repository-1",
  repository: "owner/repository",
  commit: "a".repeat(40),
  status: "completed",
  filesAnalyzed: 3,
  bytesAnalyzed: 1000,
  signals: [
    { version: 1, kind: "active_import", value: "resend", evidence: importEvidence },
    { version: 1, kind: "environment_name", value: "RESEND_API_KEY", evidence: environmentEvidence },
    { version: 1, kind: "runtime_call", value: "resend.emails.send", evidence: runtimeEvidence },
  ],
  observations: [{
    version: 1,
    serviceId: "resend",
    category: "transactional_email",
    status: "active",
    confidence: "very_high",
    evidence: [importEvidence, environmentEvidence, runtimeEvidence],
    analyzedCommit: "a".repeat(40),
  }],
  capabilities: [{
    version: 1,
    serviceId: "resend",
    capabilityId: "transactional_send",
    requirement: "required",
    confidence: "very_high",
    evidence: [runtimeEvidence],
    ownerConfirmed: false,
  }],
  ownerDecisions: [],
  warnings: [],
  unknowns: [],
  analyzerVersion: "optimizer-static-o1",
  createdAt: "2026-09-02T00:00:00.000Z",
  completedAt: "2026-09-02T00:00:01.000Z",
};

describe("repository dependency graph", () => {
  it("builds evidence-backed service, capability, package, configuration, and file nodes", () => {
    const graph = buildDependencyGraph(analysis);

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "service:resend", kind: "service" }),
      expect.objectContaining({ id: "capability:resend:transactional_send", kind: "capability" }),
      expect.objectContaining({ id: "package:resend:resend", kind: "package" }),
      expect.objectContaining({ id: "configuration:resend:RESEND_API_KEY", kind: "configuration" }),
      expect.objectContaining({ id: "file:src/email/send.ts", kind: "file" }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "capability:resend:transactional_send", to: "service:resend", relationship: "requires" }),
      expect.objectContaining({ from: "file:src/email/send.ts", to: "configuration:resend:RESEND_API_KEY", relationship: "configures" }),
    ]));
  });

  it("traverses direct and indirect dependents to calculate removal impact", () => {
    const impact = analyzeRemoval(buildDependencyGraph(analysis), "resend");

    expect(impact.level).toBe("high");
    expect(impact.capabilities).toContain("Transactional Send");
    expect(impact.configuration).toContain("RESEND_API_KEY");
    expect(impact.affectedFiles).toContain("src/email/send.ts");
    expect(impact.checklist).toEqual(expect.arrayContaining([
      expect.stringContaining("RESEND_API_KEY"),
      expect.stringContaining("Re-scan"),
    ]));
  });
});

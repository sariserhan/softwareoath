import { createHash } from "node:crypto";
import {
  receiptSignerFromEnvironment,
  signReceipt,
  verifyReceiptSignature,
  type ReceiptSigner,
  type TrustedReceiptKeys,
} from "../repair/signature";
import type { ReceiptSignature, RepairReceipt } from "../repair/types";
import type {
  AuditEventRecord,
  ControlPlaneData,
  ControlPlaneStore,
  FinalAttestation,
  IncidentRecord,
  RepositoryKnowledgeRecord,
} from "./types";

export interface AttestationBundleManifest {
  version: 1;
  generatedAt: string;
  counts: {
    incidents: number;
    finalAttestations: number;
    knowledgeRecords: number;
    auditEvents: number;
  };
  merkleRoot: string;
  signature?: ReceiptSignature;
}

export interface AttestationBundle {
  manifest: AttestationBundleManifest;
  incidents: IncidentRecord[];
  finalAttestations: FinalAttestation[];
  knowledge: RepositoryKnowledgeRecord[];
  auditEvents: AuditEventRecord[];
}

export function computeMerkleRoot(records: unknown[]): string {
  const hashes = records.map((record) =>
    createHash("sha256").update(JSON.stringify(record)).digest("hex"),
  );

  if (hashes.length === 0) {
    return createHash("sha256").update("empty-bundle").digest("hex");
  }

  let currentLayer = hashes.sort();
  while (currentLayer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        const combined = createHash("sha256")
          .update(currentLayer[i] + currentLayer[i + 1])
          .digest("hex");
        nextLayer.push(combined);
      } else {
        nextLayer.push(currentLayer[i]);
      }
    }
    currentLayer = nextLayer;
  }

  return currentLayer[0];
}

function bundleAsReceiptPayload(merkleRoot: string, generatedAt: string): Omit<RepairReceipt, "signature"> {
  return {
    version: 1,
    id: `BUNDLE-${merkleRoot.slice(0, 16)}`,
    repositoryPath: ".",
    baseCommit: merkleRoot.slice(0, 7),
    finding: {
      id: "BUNDLE-MANIFEST",
      detector: "software-oath",
      category: "maintainability",
      severity: "low",
      title: "Attestation Bundle Manifest",
      summary: "Bundle manifest",
      evidence: { detail: "Attestation bundle" },
      repair: { objective: "Export bundle", allowedPaths: [], automaticCandidate: false },
    },
    inspection: { total: 0, critical: 0, high: 0, medium: 0, low: 0, automaticCandidates: 0 },
    agent: { name: "Software Oath", summary: "Attestation Exporter", output: "" },
    changes: { files: [], withinAllowedScope: true, patchPath: "", patchSha256: merkleRoot },
    proof: {
      selectedFindingId: "BUNDLE-MANIFEST",
      selectedFindingResolved: true,
      remainingSelectedFinding: null,
      before: { total: 0, critical: 0, high: 0, medium: 0, low: 0, automaticCandidates: 0 },
      after: { total: 0, critical: 0, high: 0, medium: 0, low: 0, automaticCandidates: 0 },
      newFindings: [],
      blockingNewFindings: [],
    },
    verification: {
      version: 1,
      run: { id: "RUN-1", repository: ".", commit: merkleRoot.slice(0, 7), status: "passed" } as any,
      report: { valid: true, findings: [] } as any,
      execution: { repositoryPath: ".", startedAt: generatedAt, completedAt: generatedAt, runner: "local" },
    },
    decision: "ready",
    generatedAt,
  } as unknown as Omit<RepairReceipt, "signature">;
}

export async function exportAttestationBundle(options: {
  store: ControlPlaneStore;
  repository?: string;
  signer?: ReceiptSigner;
  now?: () => Date;
}): Promise<AttestationBundle> {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const storeData: ControlPlaneData = await (options.store as unknown as { read: () => Promise<ControlPlaneData> }).read();

  const filteredIncidents = options.repository
    ? storeData.incidents.filter((i: IncidentRecord) => {
        const matchingRun = storeData.runs.find((r) => r.incidentId === i.id);
        return matchingRun ? matchingRun.repository === options.repository : true;
      })
    : storeData.incidents;

  const finalAttestations = options.repository
    ? storeData.attestations.filter((a: FinalAttestation) => {
        const matchingRun = storeData.runs.find((r) => r.id === a.runId);
        return matchingRun ? matchingRun.repository === options.repository : true;
      })
    : storeData.attestations;

  const knowledge = options.repository
    ? storeData.knowledge.filter((k: RepositoryKnowledgeRecord) => k.repository === options.repository)
    : storeData.knowledge;

  const auditEvents = options.repository
    ? storeData.auditEvents.filter((a: AuditEventRecord) => a.repository === options.repository)
    : storeData.auditEvents;

  const allRecords = [
    ...filteredIncidents,
    ...finalAttestations,
    ...knowledge,
    ...auditEvents,
  ];

  const merkleRoot = computeMerkleRoot(allRecords);

  let signature: ReceiptSignature | undefined;
  try {
    const signer = options.signer ?? receiptSignerFromEnvironment();
    if (signer) {
      const dummy = bundleAsReceiptPayload(merkleRoot, generatedAt);
      const signed = signReceipt(dummy, signer, now());
      signature = signed.signature;
    }
  } catch {
    // Signer not configured or optional
  }

  const manifest: AttestationBundleManifest = {
    version: 1,
    generatedAt,
    counts: {
      incidents: filteredIncidents.length,
      finalAttestations: finalAttestations.length,
      knowledgeRecords: knowledge.length,
      auditEvents: auditEvents.length,
    },
    merkleRoot,
    signature,
  };

  return {
    manifest,
    incidents: filteredIncidents,
    finalAttestations,
    knowledge,
    auditEvents,
  };
}

export async function verifyAttestationBundle(
  bundle: AttestationBundle,
  trustedKeys?: TrustedReceiptKeys,
): Promise<{
  valid: boolean;
  reason?: string;
  summary: AttestationBundleManifest["counts"];
}> {
  if (!bundle || bundle.manifest?.version !== 1) {
    return {
      valid: false,
      reason: "Invalid bundle structure or unsupported manifest version.",
      summary: { incidents: 0, finalAttestations: 0, knowledgeRecords: 0, auditEvents: 0 },
    };
  }

  const allRecords = [
    ...(bundle.incidents ?? []),
    ...(bundle.finalAttestations ?? []),
    ...(bundle.knowledge ?? []),
    ...(bundle.auditEvents ?? []),
  ];

  const computedMerkleRoot = computeMerkleRoot(allRecords);
  if (computedMerkleRoot !== bundle.manifest.merkleRoot) {
    return {
      valid: false,
      reason: `Merkle root mismatch! Manifest: ${bundle.manifest.merkleRoot}, Computed: ${computedMerkleRoot}`,
      summary: bundle.manifest.counts,
    };
  }

  if (bundle.manifest.signature) {
    try {
      const dummyPayload = bundleAsReceiptPayload(bundle.manifest.merkleRoot, bundle.manifest.generatedAt);
      const signedReceipt: RepairReceipt = {
        ...dummyPayload,
        signature: bundle.manifest.signature,
      };
      verifyReceiptSignature(signedReceipt, trustedKeys);
    } catch (err) {
      return {
        valid: false,
        reason: `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
        summary: bundle.manifest.counts,
      };
    }
  }

  return {
    valid: true,
    summary: bundle.manifest.counts,
  };
}

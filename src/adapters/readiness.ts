export interface AdapterReadinessEvidenceV1 {
  version: 1;
  adapterId: string;
  readOnlyDiscovery: boolean;
  structuredUpdatesAndAdvisories: boolean;
  executionPolicyDocumented: boolean;
  conservativeSelection: boolean;
  deterministicUpdates: boolean;
  exactScopeAndProof: boolean;
  unitFixturesPassed: boolean;
  isolatedIntegrationPassed: boolean;
  endToEndRepairPassed: boolean;
  supportDocumentationPublished: boolean;
}

export function evaluateAdapterReadiness(value: unknown) {
  const evidence = value as Partial<AdapterReadinessEvidenceV1> | undefined;
  const checks = [
    { id: "evidence.schema", passed: evidence?.version === 1 &&
      typeof evidence.adapterId === "string" && evidence.adapterId.length > 0 },
    ...([
      "readOnlyDiscovery", "structuredUpdatesAndAdvisories", "executionPolicyDocumented",
      "conservativeSelection", "deterministicUpdates", "exactScopeAndProof",
      "unitFixturesPassed", "isolatedIntegrationPassed", "endToEndRepairPassed",
      "supportDocumentationPublished",
    ] as const).map((id) => ({ id: `adapter.${id}`, passed: evidence?.[id] === true })),
  ];
  return { ready: checks.every(({ passed }) => passed), checks };
}

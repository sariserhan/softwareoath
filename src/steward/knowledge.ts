import { createHash, randomUUID } from "node:crypto";

import type {
  ControlPlaneStore,
  RepositoryKnowledgeRecord,
  RepositoryQuestionRecord,
  ReviewerAuthorization,
  ReviewerIdentity,
} from "../control-plane/types";
import type { RepositoryMemory } from "./memory";

function stableId(prefix: string, repository: string, key: string): string {
  return `${prefix}-${createHash("sha256")
    .update(`${repository}:${key}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function observedKnowledge(options: {
  memory: RepositoryMemory;
  key: string;
  statement: string;
  scope: RepositoryKnowledgeRecord["scope"];
  evidence: string[];
  relatedPaths: string[];
  runId: string;
  now: string;
  existing?: RepositoryKnowledgeRecord;
}): RepositoryKnowledgeRecord {
  const { memory, existing } = options;
  return {
    id: stableId("KNOWLEDGE", memory.repository, options.key),
    repository: memory.repository,
    kind: "observed_technical_fact",
    statement: options.statement,
    scope: options.scope,
    source: {
      type: "scan",
      runId: options.runId,
      commit: memory.commit,
      evidence: options.evidence,
    },
    confidence: 1,
    relatedPaths: options.relatedPaths,
    blocksRepair: false,
    firstObservedAt: existing?.firstObservedAt ?? options.now,
    lastVerifiedAt: options.now,
    firstObservedCommit: existing?.firstObservedCommit ?? memory.commit,
    lastVerifiedCommit: memory.commit,
    createdAt: existing?.createdAt ?? options.now,
    updatedAt: options.now,
  };
}

function onboardingQuestions(
  memory: RepositoryMemory,
  now: string,
): RepositoryQuestionRecord[] {
  const repositoryEvidence = [
    `Commit ${memory.commit}`,
    `${memory.inventory.trackedFiles} tracked files`,
    `Top-level areas: ${memory.inventory.topLevelAreas.join(", ") || "none"}`,
    `Active adapters: ${memory.capabilities?.activeAdapters.join(", ") || "none"}`,
  ];
  const question = (
    key: string,
    text: string,
    why: string,
    affects: string[],
    suggestions: string[],
    kind: RepositoryQuestionRecord["answerKnowledgeKind"],
  ): RepositoryQuestionRecord => ({
    id: stableId("QUESTION", memory.repository, key),
    repository: memory.repository,
    key,
    status: "open",
    question: text,
    why,
    evidence: repositoryEvidence,
    affects,
    suggestedAnswers: suggestions,
    authorizedRole: "repository_write",
    blocking: "affected_repair",
    answerKnowledgeKind: kind,
    createdAt: now,
    updatedAt: now,
  });
  return [
    question(
      "onboarding.business-purpose",
      "What does this product or service do, and who are its primary users?",
      "Repository structure can suggest implementation responsibilities, but it cannot confirm business purpose or intended users.",
      ["business-scope inference", "repair explanations", "risk prioritization"],
      [
        "Describe the product in two or three sentences.",
        "Name the primary user groups and the value they receive.",
      ],
      "owner_confirmed_business_fact",
    ),
    question(
      "onboarding.critical-journeys-and-rules",
      "Which user journeys and business rules must never be broken by an automatic repair?",
      "Tests and code show current behavior, but only an authorized owner can confirm which behavior is a protected business invariant.",
      ["business-rule repairs", "high-risk change detection", "oath proposals"],
      [
        "List the most critical user journeys.",
        "List invariants involving money, permissions, customer data, or irreversible operations.",
      ],
      "owner_confirmed_business_rule",
    ),
    question(
      "onboarding.protected-operations",
      "Which components or operations must always require human review?",
      "Software Oath needs explicit owner policy for high-risk areas that should never receive an unattended repair proposal.",
      ["repair authorization", "protected paths", "human-review policy"],
      [
        "Identify payment, authentication, authorization, migration, or compliance-sensitive areas.",
        "Name paths or operations that must always require owner review.",
      ],
      "owner_confirmed_business_rule",
    ),
  ];
}

export async function synchronizeRepositoryKnowledge(options: {
  store: ControlPlaneStore;
  memory: RepositoryMemory;
  runId: string;
  now?: () => Date;
}): Promise<{ knowledge: number; openQuestions: number }> {
  const now = (options.now?.() ?? new Date()).toISOString();
  const existing = await options.store.listKnowledge(options.memory.repository);
  const byId = new Map(existing.map((item) => [item.id, item]));
  const candidates: RepositoryKnowledgeRecord[] = [];
  const add = (
    key: string,
    statement: string,
    scope: RepositoryKnowledgeRecord["scope"],
    evidence: string[],
    relatedPaths: string[],
  ) => {
    const id = stableId("KNOWLEDGE", options.memory.repository, key);
    candidates.push(
      observedKnowledge({
        memory: options.memory,
        key,
        statement,
        scope,
        evidence,
        relatedPaths,
        runId: options.runId,
        now,
        existing: byId.get(id),
      }),
    );
  };
  add(
    "repository.profile",
    `The repository contains ${options.memory.inventory.trackedFiles} tracked files across ${options.memory.inventory.topLevelAreas.length} top-level areas.`,
    { type: "repository", value: options.memory.repository },
    [
      `Commit ${options.memory.commit}`,
      `Top-level areas: ${options.memory.inventory.topLevelAreas.join(", ")}`,
    ],
    [],
  );
  for (const workspace of options.memory.capabilities?.workspaces ?? []) {
    add(
      `workspace.${workspace.adapterId}.${workspace.path}`,
      `${workspace.path} is a ${workspace.ecosystem} workspace with ${workspace.support} Software Oath support.`,
      { type: "workspace", value: workspace.path },
      [
        `Manifests: ${workspace.manifests.join(", ")}`,
        `Lockfiles: ${workspace.lockfiles.join(", ") || "none"}`,
        `Toolchain files: ${workspace.toolchainFiles.join(", ") || "none"}`,
      ],
      [
        ...workspace.manifests,
        ...workspace.lockfiles,
        ...workspace.toolchainFiles,
      ],
    );
  }
  for (const gap of options.memory.capabilities?.coverageGaps ?? []) {
    add(
      `coverage.${gap.adapterId}.${gap.workspacePath}`,
      `${gap.workspacePath} has a ${gap.ecosystem} coverage gap for ${gap.missingCapabilities.join(", ")}.`,
      { type: "workspace", value: gap.workspacePath },
      [
        `Adapter: ${gap.adapterId}`,
        `Manifests: ${gap.manifests.join(", ")}`,
        `Missing capabilities: ${gap.missingCapabilities.join(", ")}`,
      ],
      gap.manifests,
    );
  }
  if (options.memory.validationCommands.length) {
    add(
      "repository.validation",
      `The repository defines ${options.memory.validationCommands.length} committed validation commands.`,
      { type: "workflow", value: "software-oath.yml" },
      options.memory.validationCommands,
      ["software-oath.yml"],
    );
  }
  for (const knowledge of candidates) {
    await options.store.upsertKnowledge(knowledge);
  }
  for (const question of onboardingQuestions(options.memory, now)) {
    await options.store.upsertQuestion(question);
  }
  const questions = await options.store.listQuestions(options.memory.repository);
  return {
    knowledge: (await options.store.listKnowledge(options.memory.repository)).length,
    openQuestions: questions.filter(({ status }) => status === "open").length,
  };
}

export function knowledgeFromQuestionAnswer(options: {
  question: RepositoryQuestionRecord;
  value: string;
  identity: ReviewerIdentity;
  authorization: ReviewerAuthorization;
  now?: Date;
}): {
  answer: NonNullable<RepositoryQuestionRecord["answer"]>;
  knowledge: RepositoryKnowledgeRecord;
} {
  const answeredAt = (options.now ?? new Date()).toISOString();
  const answer = {
    value: options.value,
    identity: options.identity,
    authorization: options.authorization,
    answeredAt,
  };
  return {
    answer,
    knowledge: {
      id: `KNOWLEDGE-${randomUUID()}`,
      repository: options.question.repository,
      kind: options.question.answerKnowledgeKind,
      statement: options.value,
      scope: {
        type: "repository",
        value: options.question.repository,
      },
      source: {
        type: "owner_answer",
        questionId: options.question.id,
        evidence: [
          options.question.question,
          ...options.question.evidence,
        ],
      },
      confidence: 1,
      relatedPaths: [],
      blocksRepair: false,
      firstObservedAt: answeredAt,
      lastVerifiedAt: answeredAt,
      confirmedBy: options.identity,
      confirmedAuthorization: options.authorization,
      createdAt: answeredAt,
      updatedAt: answeredAt,
    },
  };
}

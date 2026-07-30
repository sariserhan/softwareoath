import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileControlPlaneStore } from "../control-plane/store";
import type { RepositoryMemory } from "./memory";
import {
  knowledgeFromQuestionAnswer,
  synchronizeRepositoryKnowledge,
} from "./knowledge";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function memory(commit = "abc123"): RepositoryMemory {
  return {
    version: 1,
    repositoryPath: "C:/fixture",
    repository: "owner/repo",
    branch: "main",
    commit,
    generatedAt: "2026-07-30T12:00:00Z",
    scanCount: 1,
    inventory: {
      trackedFiles: 12,
      extensions: { ".ts": 5 },
      topLevelAreas: ["package.json", "src"],
      manifests: ["package.json"],
      lockfiles: ["package-lock.json"],
      workflows: [".github/workflows/ci.yml"],
      tests: ["src/app.test.ts"],
      architectureDocuments: ["README.md"],
    },
    validationCommands: ["npm test"],
    capabilities: {
      version: 1,
      generatedAt: "2026-07-30T12:00:00Z",
      activeAdapters: ["npm"],
      coverageGaps: [],
      workspaces: [
        {
          path: ".",
          adapterId: "npm",
          ecosystem: "npm",
          support: "active",
          manifests: ["package.json"],
          lockfiles: ["package-lock.json"],
          toolchainFiles: [],
          capabilities: [
            { name: "dependency-updates", status: "active" },
          ],
          execution: {
            network: "package-registry",
            installsApplicationDependencies: false,
            runsLifecycleScripts: false,
          },
        },
      ],
    },
    health: {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      automaticCandidates: 0,
    },
    findings: [],
    history: [],
  };
}

describe("repository knowledge and owner questions", () => {
  it("synchronizes observed facts idempotently and keeps first provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-knowledge-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const first = await synchronizeRepositoryKnowledge({
      store,
      memory: memory("abc123"),
      runId: "RUN-1",
      now: () => new Date("2026-07-30T12:00:00Z"),
    });
    const second = await synchronizeRepositoryKnowledge({
      store,
      memory: memory("def456"),
      runId: "RUN-2",
      now: () => new Date("2026-07-31T12:00:00Z"),
    });

    expect(first).toEqual({ knowledge: 3, openQuestions: 3 });
    expect(second).toEqual({ knowledge: 3, openQuestions: 3 });
    const knowledge = await store.listKnowledge("owner/repo");
    expect(knowledge).toHaveLength(3);
    expect(knowledge[0]).toMatchObject({
      firstObservedAt: "2026-07-30T12:00:00.000Z",
      lastVerifiedAt: "2026-07-31T12:00:00.000Z",
      firstObservedCommit: "abc123",
      lastVerifiedCommit: "def456",
    });
    expect(await store.listQuestions("owner/repo")).toHaveLength(3);
  });

  it("turns one authorized answer into immutable owner-confirmed knowledge", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-knowledge-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    await synchronizeRepositoryKnowledge({
      store,
      memory: memory(),
      runId: "RUN-1",
      now: () => new Date("2026-07-30T12:00:00Z"),
    });
    const question = (await store.listQuestions("owner/repo"))[0];
    const prepared = knowledgeFromQuestionAnswer({
      question,
      value: "This service lets store operators manage customer orders.",
      identity: {
        provider: "github",
        providerUserId: "42",
        login: "owner",
      },
      authorization: {
        repository: "owner/repo",
        permission: "maintain",
        verifiedAt: "2026-07-30T12:05:00Z",
      },
      now: new Date("2026-07-30T12:05:00Z"),
    });
    const answered = await store.answerQuestion(
      question.id,
      prepared.answer,
      prepared.knowledge,
    );

    expect(answered).toMatchObject({
      status: "answered",
      knowledgeId: prepared.knowledge.id,
      answer: {
        value: "This service lets store operators manage customer orders.",
        identity: { login: "owner" },
      },
    });
    expect(await store.listKnowledge("owner/repo")).toContainEqual(
      expect.objectContaining({
        kind: "owner_confirmed_business_fact",
        confidence: 1,
        confirmedBy: expect.objectContaining({ login: "owner" }),
      }),
    );
    await expect(
      store.answerQuestion(question.id, prepared.answer, prepared.knowledge),
    ).rejects.toThrow("already been answered");
  });
});

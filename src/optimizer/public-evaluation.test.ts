import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  summarizePublicEvaluation,
  validatePublicEvaluationSet,
  type PublicRepositoryEvaluationSetV1,
} from "./public-evaluation.js";

describe("public optimizer evaluation", () => {
  it("keeps a diverse, immutable, manually reviewed public set", async () => {
    const evaluation = JSON.parse(
      await readFile(
        resolve("fixtures/optimizer/public-repositories.json"),
        "utf8",
      ),
    ) as PublicRepositoryEvaluationSetV1;

    expect(() => validatePublicEvaluationSet(evaluation)).not.toThrow();
    expect(evaluation.repositories).toHaveLength(6);
    expect(evaluation.repositories.filter(
      (item) => item.expectedStatus === "active",
    )).toHaveLength(4);
    expect(evaluation.repositories.filter(
      (item) => item.expectedStatus === "inactive",
    )).toHaveLength(2);
    expect(evaluation.repositories.some(
      (item) => item.notes.some((note) => note.includes("wrapper")),
    )).toBe(true);
  });

  it("requires exact status and capability labels in addition to precision", () => {
    const expected = [
      {
        repository: "owner/active",
        commit: "a".repeat(40),
        expectedStatus: "active" as const,
        expectedCapabilities: ["transactional_send"],
        reviewedPaths: ["src/email.ts"],
        notes: [],
      },
      {
        repository: "owner/inactive",
        commit: "b".repeat(40),
        expectedStatus: "inactive" as const,
        expectedCapabilities: [],
        reviewedPaths: ["package.json"],
        notes: [],
      },
    ];
    const passed = summarizePublicEvaluation(expected, [
      {
        repository: "owner/active",
        commit: "a".repeat(40),
        actualStatus: "active",
        actualCapabilities: ["transactional_send"],
      },
      {
        repository: "owner/inactive",
        commit: "b".repeat(40),
        actualStatus: "inactive",
        actualCapabilities: [],
      },
    ]);
    expect(passed).toMatchObject({
      repositories: 2,
      unsupported: 0,
      statusMatches: 2,
      exactCapabilityMatches: 2,
      capabilityAccuracy: 1,
      passed: true,
      serviceDetection: {
        precision: 1,
        recall: 1,
      },
    });

    const mislabeled = summarizePublicEvaluation(expected, [
      {
        repository: "owner/active",
        commit: "a".repeat(40),
        actualStatus: "active",
        actualCapabilities: [],
      },
      {
        repository: "owner/inactive",
        commit: "b".repeat(40),
        actualStatus: "inactive",
        actualCapabilities: [],
      },
    ]);
    expect(mislabeled.serviceDetection.precision).toBe(1);
    expect(mislabeled.exactCapabilityMatches).toBe(1);
    expect(mislabeled.passed).toBe(false);
  });
});

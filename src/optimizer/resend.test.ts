import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeRepositoryStatic } from "./analyze";
import { isOptimizerSourcePath } from "./resend";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const corpusRoot = resolve("fixtures/optimizer");

interface Expectation {
  fixture: string;
  expectedStatus: "active" | "inactive" | "ambiguous";
  expectedCapabilities: string[];
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function analyzeFixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), "software-oath-resend-corpus-"));
  roots.push(root);
  await cp(join(corpusRoot, name), root, { recursive: true });
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", "fixture"], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
  return analyzeRepositoryStatic({ repositoryPath: root });
}

describe("Resend optimizer corpus", () => {
  it("excludes example, generated, vendored, test, and mock source paths", () => {
    expect([
      "examples/resend.ts",
      "vendor/resend.ts",
      "generated/resend.ts",
      "src/resend.test.ts",
      "src/resend.spec.ts",
      "src/resend.mock.ts",
      "src/mock.resend.ts",
    ].every((path) => !isOptimizerSourcePath(path))).toBe(true);
    expect(isOptimizerSourcePath("src/email.ts")).toBe(true);
  });

  it("matches every labeled status and required capability with perfect active-use metrics", async () => {
    const names = (await readdir(corpusRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("resend-"))
      .map((entry) => entry.name)
      .sort();
    const expectations = await Promise.all(
      names.map(async (name) =>
        JSON.parse(
          await readFile(join(corpusRoot, name, "expectation.json"), "utf8"),
        ) as Expectation),
    );

    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const expectation of expectations) {
      const analysis = await analyzeFixture(expectation.fixture);
      const observation = analysis.observations.find(
        (candidate) => candidate.serviceId === "resend",
      );
      const actualStatus = observation?.status ?? "inactive";
      const actualCapabilities = analysis.capabilities
        .filter((capability) => capability.serviceId === "resend")
        .map((capability) => capability.capabilityId)
        .sort();

      expect(actualStatus, expectation.fixture).toBe(expectation.expectedStatus);
      expect(actualCapabilities, expectation.fixture).toEqual(
        [...expectation.expectedCapabilities].sort(),
      );

      const expectedActive = expectation.expectedStatus === "active";
      const actualActive = actualStatus === "active";
      if (expectedActive && actualActive) truePositive += 1;
      if (!expectedActive && actualActive) falsePositive += 1;
      if (expectedActive && !actualActive) falseNegative += 1;
    }

    expect(expectations).toHaveLength(11);
    expect({
      precision: truePositive / (truePositive + falsePositive),
      recall: truePositive / (truePositive + falseNegative),
    }).toEqual({ precision: 1, recall: 1 });
  });
});

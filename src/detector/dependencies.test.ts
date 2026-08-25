import { describe, expect, it } from "vitest";

import {
  dependencyUpdateKind,
  inspectDependencies,
  inspectPythonManifest,
  inspectRustManifest,
  type DependencyCommandRunner,
} from "./dependencies.js";

describe("dependency stewardship", () => {
  it("classifies semantic version changes conservatively", () => {
    expect(dependencyUpdateKind("1.2.3", "1.2.4")).toBe("patch");
    expect(dependencyUpdateKind("1.2.3", "1.3.0")).toBe("minor");
    expect(dependencyUpdateKind("1.2.3", "2.0.0")).toBe("major");
    expect(dependencyUpdateKind("workspace:*", "2.0.0")).toBe("unknown");
  });

  it("creates update and security findings from npm's structured output", async () => {
    const runner: DependencyCommandRunner = async (_command, args) => {
      if (args.includes("outdated")) {
        return {
          exitCode: 1,
          stderr: "",
          stdout: JSON.stringify({
            lodash: { current: "4.17.20", wanted: "4.17.21", latest: "4.17.21" },
            react: { current: "18.2.0", wanted: "18.3.1", latest: "19.1.0" },
          }),
        };
      }
      return {
        exitCode: 1,
        stderr: "",
        stdout: JSON.stringify({
          vulnerabilities: {
            lodash: {
              severity: "high",
              isDirect: true,
              via: [{ source: 1234, title: "Prototype pollution" }],
              fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false },
            },
            transitive: {
              severity: "moderate",
              isDirect: false,
              via: ["parent"],
              fixAvailable: false,
            },
          },
        }),
      };
    };

    const result = await inspectDependencies({
      repositoryPath: "C:/fixture",
      files: ["package.json", "package-lock.json"],
      commandRunner: runner,
    });

    expect(result.findings).toHaveLength(4);
    expect(result.findings.find(({ detector }) => detector === "npm-security-advisory"))
      .toMatchObject({
        severity: "high",
        repair: { automaticCandidate: true },
        dependency: {
          packageName: "lodash",
          targetVersion: "4.17.21",
          advisoryIds: ["1234"],
        },
      });
    expect(result.findings.find(({ id }) => id.includes("transitive")))
      .toMatchObject({ repair: { automaticCandidate: false } });
  });

  it("reports advisory scan failures instead of silently claiming clean health", async () => {
    const result = await inspectDependencies({
      repositoryPath: "C:/fixture",
      files: ["package.json", "package-lock.json"],
      commandRunner: async (_command, args) => ({
        exitCode: args.includes("outdated") ? 0 : 127,
        stdout: "",
        stderr: args.includes("outdated") ? "" : "npm is unavailable",
      }),
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        detector: "npm-advisory-check-failure",
        category: "security",
        repair: expect.objectContaining({ automaticCandidate: false }),
      }),
    ]);
  });

  it("detects unpinned Python requirements and wildcard Rust Cargo dependencies", async () => {
    const pythonFindings = await inspectPythonManifest(
      "requirements.txt",
      "requests>=2.28.0\nflask==2.3.2\n",
    );
    expect(pythonFindings).toHaveLength(1);
    expect(pythonFindings[0].dependency?.packageName).toBe("requests");
    expect(pythonFindings[0].detector).toBe("python-unpinned");

    const rustFindings = await inspectRustManifest(
      "Cargo.toml",
      '[dependencies]\nserde = "*"\ntokio = "1.0"\n',
    );
    expect(rustFindings).toHaveLength(1);
    expect(rustFindings[0].dependency?.packageName).toBe("serde");
    expect(rustFindings[0].detector).toBe("rust-wildcard-version");
  });
});

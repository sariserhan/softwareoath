import { describe, expect, it, vi } from "vitest";

import type { RepositoryFinding } from "../detector/types";
import { assertTrustedNpmLockfile, prepareNpmRepairWorkspace } from "./npm";

describe("isolated npm workspace preparation", () => {
  it("accepts only HTTPS npm registry lockfile sources", () => {
    expect(() =>
      assertTrustedNpmLockfile(JSON.stringify({
        packages: {
          "node_modules/example": {
            resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
          },
        },
      })),
    ).not.toThrow();
    expect(() =>
      assertTrustedNpmLockfile(JSON.stringify({
        packages: {
          "node_modules/example": {
            resolved: "https://example.test/example.tgz",
          },
        },
      })),
    ).toThrow("outside the trusted registry");
    expect(() =>
      assertTrustedNpmLockfile(JSON.stringify({
        packages: {
          example: { resolved: "git+ssh://github.com/example/example.git" },
        },
      })),
    ).toThrow("outside the trusted registry");
  });

  it("runs npm ci with scripts disabled in the network preparation runner", async () => {
    const execute = vi.fn(async () => ({
      exitCode: 0,
      output: "",
      durationMs: 1,
    }));
    const finding = {
      dependency: {
        ecosystem: "npm",
        packageName: "example",
        manifestPath: "package.json",
        lockfilePath: "package-lock.json",
      },
    } as RepositoryFinding;

    await expect(
      prepareNpmRepairWorkspace({
        workspacePath: process.cwd(),
        finding,
        runner: { name: "fixture-preparer", execute },
      }),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.stringContaining("npm ci --ignore-scripts"),
      workspacePath: process.cwd(),
    }));
  });
});

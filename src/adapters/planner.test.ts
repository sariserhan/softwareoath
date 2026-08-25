import { describe, expect, it, vi } from "vitest";

import { analyzeWithAdapters, createAdapterRegistry } from "./registry.js";
import { buildCapabilityPlan } from "./planner.js";

describe("repository adapter planning", () => {
  it("discovers workspaces without executing an adapter or installing dependencies", () => {
    const analyze = vi.fn();
    const plan = buildCapabilityPlan({
      files: [
        "package.json",
        "package-lock.json",
        ".nvmrc",
        "services/api/pyproject.toml",
        "services/api/uv.lock",
        "services/core/Cargo.toml",
        "services/core/rust-toolchain.toml",
      ],
      adapters: [
        {
          id: "fixture",
          ecosystem: "fixture",
          support: "active",
          manifestBasenames: ["package.json"],
          lockfileBasenames: ["package-lock.json"],
          toolchainBasenames: [".nvmrc"],
          capabilities: ["dependency-updates"],
          execution: {
            network: "none",
            installsApplicationDependencies: false,
            runsLifecycleScripts: false,
          },
          analyze,
        },
        ...createAdapterRegistry().filter(({ id }) => id !== "npm"),
      ],
      now: () => new Date("2026-07-30T12:00:00Z"),
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(plan.workspaces).toEqual([
      expect.objectContaining({
        path: ".",
        adapterId: "fixture",
        manifests: ["package.json"],
        lockfiles: ["package-lock.json"],
        toolchainFiles: [".nvmrc"],
        execution: {
          network: "none",
          installsApplicationDependencies: false,
          runsLifecycleScripts: false,
        },
      }),
      expect.objectContaining({
        path: "services/api",
        adapterId: "python",
        support: "planned",
      }),
      expect.objectContaining({
        path: "services/core",
        adapterId: "rust",
        support: "planned",
        toolchainFiles: ["services/core/rust-toolchain.toml"],
      }),
    ]);
  });

  it("activates only matching active adapters and exposes unsupported coverage", async () => {
    const commandRunner = vi.fn(async (_command: string, args: string[]) => ({
      exitCode: 0,
      stdout: args.includes("audit")
        ? '{"vulnerabilities":{}}'
        : "{}",
      stderr: "",
    }));
    const result = await analyzeWithAdapters({
      repositoryPath: "C:/fixture",
      files: [
        "frontend/package.json",
        "frontend/package-lock.json",
        "backend/go.mod",
      ],
      dependencyCommandRunner: commandRunner,
      now: () => new Date("2026-07-30T12:00:00Z"),
    });

    expect(commandRunner).toHaveBeenCalledTimes(2);
    expect(result.plan.activeAdapters).toEqual(["npm"]);
    expect(result.plan.coverageGaps).toEqual([
      expect.objectContaining({
        adapterId: "go",
        workspacePath: "backend",
      }),
    ]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        detector: "adapter-coverage-gap",
        title: "go dependency coverage is not active yet",
      }),
    ]);
  });

  it("selects the declared JavaScript package manager and recognizes patterned manifests", () => {
    const plan = buildCapabilityPlan({
      files: [
        "web/package.json",
        "web/pnpm-lock.yaml",
        "api/requirements-dev.txt",
        "services/Worker/Worker.csproj",
      ],
      adapters: createAdapterRegistry(),
    });

    expect(plan.workspaces).toEqual([
      expect.objectContaining({
        path: "api",
        adapterId: "python",
        manifests: ["api/requirements-dev.txt"],
      }),
      expect.objectContaining({
        path: "services/Worker",
        adapterId: "dotnet",
        manifests: ["services/Worker/Worker.csproj"],
      }),
      expect.objectContaining({
        path: "web",
        adapterId: "pnpm",
        lockfiles: ["web/pnpm-lock.yaml"],
      }),
    ]);
    expect(plan.activeAdapters).toEqual([]);
    expect(plan.coverageGaps.map(({ adapterId }) => adapterId)).toEqual([
      "python",
      "dotnet",
      "pnpm",
    ]);
  });
});

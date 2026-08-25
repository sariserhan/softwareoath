import { describe, expect, it, vi } from "vitest";

import { createAuditAdapter } from "./audit.js";

const workspace = {
  path: ".",
  adapterId: "go",
  ecosystem: "go",
  support: "active" as const,
  manifests: ["go.mod"],
  lockfiles: ["go.sum"],
  toolchainFiles: [],
  capabilities: ["security-advisories"] as ["security-advisories"],
  execution: {
    network: "package-registry" as const,
    installsApplicationDependencies: false,
    runsLifecycleScripts: false,
  },
};

function adapter(
  commandRunner?: (
    command: string,
    args: string[],
    cwd: string,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
) {
  return createAuditAdapter({
    id: "go",
    manifests: ["go.mod"],
    lockfiles: ["go.sum"],
    command: "govulncheck",
    args: ["-json", "./..."],
    commandRunner,
  });
}

describe("advisory adapter", () => {
  it("fails closed with an explicit finding when the runner is unavailable", async () => {
    const findings = await adapter().analyze!({
      repositoryPath: "/repo",
      files: ["go.mod", "go.sum"],
      workspace,
    });

    expect(findings[0]).toMatchObject({
      detector: "go-advisory-tool-unavailable",
      severity: "low",
      repair: { automaticCandidate: false },
    });
  });

  it("handles NDJSON and reports verified vulnerabilities without automatic repair", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 3,
      stdout: '{"Finding":{"osv":"GO-2026-0001"}}\n{"Config":{}}',
      stderr: "",
    }));
    const findings = await adapter(runner).analyze!({
      repositoryPath: "/isolated/repo",
      files: ["go.mod", "go.sum"],
      workspace,
    });

    expect(runner).toHaveBeenCalledWith(
      "govulncheck",
      ["-json", "./..."],
      "/isolated/repo",
    );
    expect(findings[0]).toMatchObject({
      detector: "go-security-advisory",
      severity: "high",
      repair: { automaticCandidate: false },
    });
  });

  it("requires the declared package-manager lockfile", () => {
    const pnpm = createAuditAdapter({
      id: "pnpm",
      manifests: ["package.json"],
      lockfiles: ["pnpm-lock.yaml"],
      command: "pnpm",
      args: ["audit", "--json"],
      requiredLockfiles: ["pnpm-lock.yaml"],
    });

    expect(
      pnpm.matchesWorkspace!({ workspacePath: ".", files: ["package.json"] }),
    ).toBe(false);
    expect(
      pnpm.matchesWorkspace!({
        workspacePath: ".",
        files: ["package.json", "pnpm-lock.yaml"],
      }),
    ).toBe(true);
  });
});

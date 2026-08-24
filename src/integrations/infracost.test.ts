import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  detectInfrastructureAsCode,
  evaluateCostChange,
  normalizeInfracostOutput,
  RemoteInfracostScanner,
} from "./infracost";

const policy = { enabled: true, requireEstimate: true, currency: "USD", maxMonthlyIncrease: 20, maxPercentageIncrease: 10 };

afterEach(() => vi.unstubAllGlobals());

describe("Infracost integration", () => {
  it("uses the authenticated dedicated broker endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      output: "{\\\"totalMonthlyCost\\\":\\\"12\\\"}",
      durationMs: 42,
      runner: "software-oath-runner@sha256:abc",
    })));
    vi.stubGlobal("fetch", fetcher);
    const scanner = new RemoteInfracostScanner({
      baseUrl: "http://runner-broker:8790/",
      token: "broker-secret",
    });

    await expect(scanner.scan("/workspaces/repository", "USD")).resolves.toMatchObject({
      durationMs: 42,
      runner: "software-oath-runner@sha256:abc",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://runner-broker:8790/cost-analysis",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer broker-secret" }),
        body: JSON.stringify({ workspacePath: "/workspaces/repository", currency: "USD" }),
      }),
    );
  });
  it("keeps the API key in the broker and pins the runner binary by checksum", async () => {
    const compose = parse(await readFile(join(process.cwd(), "compose.yml"), "utf8")) as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    expect(compose.services["runner-broker"].environment?.INFRACOST_API_KEY)
      .toBe("${INFRACOST_API_KEY}");
    expect(compose.services.api.environment?.INFRACOST_API_KEY).toBe("");
    expect(compose.services.worker.environment?.INFRACOST_API_KEY).toBe("");

    const dockerfile = await readFile(join(process.cwd(), "Dockerfile.runner"), "utf8");
    expect(dockerfile).toContain("INFRACOST_VERSION=0.10.45");
    expect(dockerfile).toContain("e2f527d8391a87ac00bfc55237ff875107861715e234bbbeb9b6015aba576c77");
    expect(dockerfile).toContain("sha256sum -c -");

    const broker = await readFile(join(process.cwd(), "scripts/runner-broker.ts"), "utf8");
    expect(broker).toContain('request.url === "/cost-analysis"');
    expect(broker).toContain('const costRunner = runner("bridge"');
    expect(broker).toContain("INFRACOST_CURRENCY: currency");
    expect(broker).toContain("infracost breakdown --path . --format json");
  });

  it("detects Terraform, Terragrunt, and CloudFormation without scanning dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-iac-"));
    try {
      await writeFile(join(root, "main.tf"), "resource \"aws_s3_bucket\" \"x\" {}\n");
      await writeFile(join(root, "template.yml"), "Resources:\n  Queue:\n    Type: AWS::SQS::Queue\n");
      expect(await detectInfrastructureAsCode(root)).toEqual(["main.tf", "template.yml"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("normalizes JSON output and blocks increases beyond owner limits", () => {
    const baselineOutput = JSON.stringify({ currency: "USD", totalMonthlyCost: "100", projects: [{ breakdown: { resources: [{}] } }] });
    const proposedOutput = JSON.stringify({ currency: "USD", totalMonthlyCost: "125", projects: [{ breakdown: { resources: [{}, {}] } }] });
    const evidence = evaluateCostChange({
      policy, detectedFiles: ["main.tf"],
      baseline: normalizeInfracostOutput(baselineOutput, "USD"),
      proposed: normalizeInfracostOutput(proposedOutput, "USD"),
      baselineScan: { output: baselineOutput, durationMs: 10, runner: "infracost-runner" },
      proposedScan: { output: proposedOutput, durationMs: 12, runner: "infracost-runner" },
      baselinePath: "/tmp/before.json", proposedPath: "/tmp/after.json",
    });
    expect(evidence).toMatchObject({ status: "blocked", monthlyCostChange: 25, percentageChange: 25, resources: 2 });
    expect(evidence.artifacts?.baselineSha256).toHaveLength(64);
  });

  it("blocks incomplete required estimates with unsupported resources", () => {
    const output = JSON.stringify({
      currency: "USD",
      totalMonthlyCost: "100",
      projects: [{ breakdown: { resources: [] } }],
      summary: {
        totalDetectedResources: 1,
        totalUnsupportedResources: 1,
        unsupportedResourceCounts: { aws_unknown_resource: 1 },
      },
    });
    expect(evaluateCostChange({
      policy,
      detectedFiles: ["main.tf"],
      baseline: normalizeInfracostOutput(output, "USD"),
      proposed: normalizeInfracostOutput(output, "USD"),
      baselineScan: { output, durationMs: 1, runner: "infracost-runner" },
      proposedScan: { output, durationMs: 1, runner: "infracost-runner" },
      baselinePath: "/tmp/before.json",
      proposedPath: "/tmp/after.json",
    })).toMatchObject({
      status: "blocked",
      unsupportedResources: ["aws_unknown_resource"],
    });
  });

  it("fails closed when required analysis is unavailable", () => {
    expect(evaluateCostChange({ policy, detectedFiles: ["main.tf"], error: "Authentication failed." })).toMatchObject({
      status: "blocked", reasons: ["Authentication failed."],
    });
  });
});

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { FileControlPlaneStore } from "../control-plane/store.js";
import type { OptimizerAnalysisRecordV1 } from "./types.js";
import { analyzeRepositoryStatic } from "./analyze.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "software-oath-optimizer-o1-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      dependencies: { resend: "^4.0.0", stripe: "^18.0.0" },
      devDependencies: { "docs-only": "1.0.0" },
    }),
  );
  await writeFile(
    join(root, "src", "email.ts"),
    [
      'import { Resend } from "resend";',
      'import Stripe from "stripe";',
      'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);',
      '// import { Fake } from "comment-provider";',
      "const client = new Resend(process.env.RESEND_API_KEY);",
      'export const send = () => client.emails.send({ to: "a@example.com", react: "Receipt", tags: [{ name: "kind", value: "receipt" }] }, { idempotencyKey: "receipt/1" });',
      'export const addContact = () => client.contacts.create({ email: "a@example.com" });',
      'export const addDomain = () => client.domains.create({ name: "example.com" });',
      'export const endpoint = "https://api.resend.com/emails";',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(root, ".env.example"),
    "RESEND_API_KEY=must-never-be-retained\nDATABASE_URL=also-secret\n",
  );
  await writeFile(
    join(root, "main.tf"),
    'resource "aws_s3_bucket" "uploads" {}\n',
  );
  await writeFile(
    join(root, "compose.yml"),
    "services:\n  redis:\n    image: redis:7\n",
  );
  await writeFile(join(root, "untracked-secret.txt"), "PRIVATE_TOKEN=secret\n");
  await symlink("/etc/passwd", join(root, "src", "tracked-link.ts"));
  await execFileAsync(
    "git",
    ["add", "package.json", "src/email.ts", ".env.example", "main.tf", "compose.yml", "src/tracked-link.ts"],
    { cwd: root },
  );
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
  return root;
}

describe("optimizer O1 static analysis", () => {
  it("reads tracked text only, emits normalized signals, and never retains values", async () => {
    const repositoryPath = await fixture();
    const analysis = await analyzeRepositoryStatic({ repositoryPath });

    expect(analysis.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(analysis.filesAnalyzed).toBe(5);
    expect(analysis.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "manifest_dependency", value: "resend" }),
        expect.objectContaining({ kind: "active_import", value: "resend" }),
        expect.objectContaining({ kind: "environment_name", value: "RESEND_API_KEY" }),
        expect.objectContaining({ kind: "api_hostname", value: "api.resend.com" }),
        expect.objectContaining({
          kind: "infrastructure_declaration",
          value: "aws_s3_bucket",
        }),
        expect.objectContaining({
          kind: "infrastructure_declaration",
          value: "redis:7",
        }),
      ]),
    );
    expect(analysis.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceId: "stripe", status: "active" }),
    ]));
    expect(analysis.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceId: "stripe", capabilityId: "payment_processing" }),
      expect.objectContaining({
        serviceId: "resend",
        capabilityId: "html_email",
      }),
    ]));
    expect(analysis.capabilities.map((item) => item.capabilityId)).toEqual(
      expect.arrayContaining([
        "transactional_send",
        "html_email",
        "message_tags",
        "idempotency",
        "contacts_audiences",
        "sending_domains",
      ]),
    );
    const serialized = JSON.stringify(analysis);
    expect(serialized).not.toContain("must-never-be-retained");
    expect(serialized).not.toContain("also-secret");
    expect(serialized).not.toContain("PRIVATE_TOKEN");
    expect(serialized).not.toContain("comment-provider");
    expect(serialized).not.toContain("/etc/passwd");
    expect(analysis.warnings).toContain("Skipped symbolic link src/tracked-link.ts.");
    expect(analysis.signals.every((signal) => !("snippet" in signal.evidence))).toBe(true);
  });

  it("excludes docs, examples, tests, generated, and vendor paths for every service", async () => {
    const repositoryPath = await fixture();
    const ignored = [
      "docs/stripe.ts",
      "examples/openai.ts",
      "vendor/twilio.ts",
      "generated/sentry.ts",
      "src/clerk.test.ts",
    ];
    for (const path of ignored) {
      await mkdir(join(repositoryPath, path.split("/").slice(0, -1).join("/")), { recursive: true });
      await writeFile(join(repositoryPath, path), 'import client from "stripe";\nclient.call();\n');
    }
    await execFileAsync("git", ["add", ...ignored], { cwd: repositoryPath });
    await execFileAsync("git", ["commit", "-qm", "ignored sources"], {
      cwd: repositoryPath,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.com",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.com",
      },
    });
    const analysis = await analyzeRepositoryStatic({ repositoryPath });
    expect(analysis.signals.some((signal) => ignored.includes(signal.evidence.file)))
      .toBe(false);
  });

  it("binds stored analyses to a registered repository and immutable tenant key", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-optimizer-store-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const now = "2026-08-24T00:00:00.000Z";
    await store.upsertRepository({
      id: "REPOSITORY-1",
      repository: "owner/repo",
      cloneUrl: "https://github.test/owner/repo.git",
      defaultBranch: "main",
      installationId: 42,
      schedule: { mode: "disabled", timezone: "UTC" },
      policy: {
        maxPullRequestsPerRun: 1,
        maxCiRepairAttempts: 2,
        allowMajorPackageUpdates: false,
        automaticMerge: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    const analysis: OptimizerAnalysisRecordV1 = {
      version: 1,
      id: "OPTIMIZER-1",
      tenantKey: "github-installation:42",
      repositoryId: "REPOSITORY-1",
      repository: "owner/repo",
      commit: "a".repeat(40),
      status: "completed",
      filesAnalyzed: 2,
      bytesAnalyzed: 100,
      signals: [],
      observations: [],
      capabilities: [],
      unknowns: [],
      ownerDecisions: [],
      warnings: [],
      analyzerVersion: "optimizer-static-o1",
      createdAt: now,
      completedAt: now,
    };
    await expect(store.saveOptimizerAnalysis(analysis)).resolves.toEqual(analysis);
    await expect(store.listOptimizerAnalyses("owner/repo")).resolves.toEqual([analysis]);
    const ownerDecision = {
      version: 1 as const,
      id: "OPTIMIZER-DECISION-1",
      serviceId: "resend",
      decision: "confirmed" as const,
      reason: "The repository owner verified the observation.",
      actor: {
        provider: "github" as const,
        providerUserId: "42",
        login: "owner",
      },
      authorization: {
        permission: "maintain" as const,
        verifiedAt: now,
      },
      createdAt: now,
    };
    await expect(
      store.recordOptimizerDecision(analysis.id, "owner/repo", ownerDecision),
    ).resolves.toMatchObject({ ownerDecisions: [ownerDecision] });
    await expect(store.saveOptimizerAnalysis({
      ...analysis,
      warnings: ["reanalyzed"],
    })).resolves.toMatchObject({ ownerDecisions: [ownerDecision] });
    await expect(
      store.recordOptimizerDecision(
        analysis.id,
        "owner/other",
        { ...ownerDecision, id: "OPTIMIZER-DECISION-2" },
      ),
    ).rejects.toThrow(/not found/);
    await expect(store.saveOptimizerAnalysis({
      ...analysis,
      tenantKey: "github-installation:99",
    })).rejects.toThrow(/ownership cannot be changed/);
    await expect(store.saveOptimizerAnalysis({
      ...analysis,
      id: "OPTIMIZER-2",
      repositoryId: "REPOSITORY-OTHER",
    })).rejects.toThrow(/registered repository/);
    await store.deleteRepositoryData("owner/repo");
    await expect(store.listOptimizerAnalyses("owner/repo")).resolves.toEqual([]);
    await expect(store.getOptimizerAnalysis(analysis.id)).resolves.toBeUndefined();
  });
});

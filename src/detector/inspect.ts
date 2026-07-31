import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { runMaintenance } from "../maintainer/run";
import type { MaintenanceReceipt } from "../maintainer/run";
import type {
  InspectionReport,
  RepositoryFinding,
} from "./types";
import { analyzeWithAdapters } from "../adapters/registry";
import type { DependencyCommandRunner } from "./dependencies";

const execFileAsync = promisify(execFile);
const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);
const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];
const SECRET_FILENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);
const SECRET_EXTENSIONS = new Set([".key", ".p12", ".pfx", ".pem"]);
const LARGE_SOURCE_LINES = 1_000;

export interface InspectOptions {
  repositoryPath: string;
  now?: () => Date;
  includeOathChecks?: boolean;
  maintenanceReceipt?: MaintenanceReceipt;
  includeDependencyChecks?: boolean;
  allowMajorPackageUpdates?: boolean;
  dependencyCommandRunner?: DependencyCommandRunner;
}

async function trackedFiles(repositoryPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "-z"],
      {
        cwd: repositoryPath,
        encoding: "buffer",
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    throw new Error(
      "Repository inspection requires a Git repository with tracked files.",
    );
  }
}

function findingId(detector: string, path: string, line?: number): string {
  const normalized = `${detector}:${path}:${line ?? 0}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized;
}

function detectSecretFiles(files: string[]): RepositoryFinding[] {
  return files.flatMap((path) => {
    const name = basename(path);
    const secret =
      SECRET_FILENAMES.has(name) ||
      (SECRET_EXTENSIONS.has(extname(name).toLowerCase()) &&
        !name.endsWith(".example"));
    if (!secret) return [];

    return [
      {
        id: findingId("tracked-secret-file", path),
        detector: "tracked-secret-file",
        category: "security",
        severity: "critical",
        title: "Potential secret file is tracked by Git",
        summary: `${path} looks like a credential-bearing file and is present in the repository index.`,
        evidence: {
          path,
          detail: "The filename matches a private key or environment-secret pattern.",
        },
        repair: {
          objective:
            "Remove the file from version control, rotate exposed credentials, and add an appropriate ignore rule.",
          allowedPaths: [path, ".gitignore"],
          automaticCandidate: false,
        },
      } satisfies RepositoryFinding,
    ];
  });
}

function detectPackageLock(
  files: string[],
): RepositoryFinding[] {
  return files
    .filter((path) => basename(path) === "package.json")
    .flatMap((manifestPath) => {
      const directory = dirname(manifestPath).replaceAll("\\", "/");
      const pathFor = (name: string) =>
        directory === "." ? name : `${directory}/${name}`;
      if (LOCKFILES.some((lockfile) => files.includes(pathFor(lockfile)))) {
        return [];
      }
      return [
        {
          id: findingId("package-lockfile-missing", manifestPath),
          detector: "package-lockfile",
          category: "dependencies",
          severity: "high",
          title: "JavaScript dependencies are not locked",
          summary:
            `${manifestPath} is tracked, but no supported package-manager lockfile is tracked in its workspace.`,
          evidence: {
            path: manifestPath,
            detail: `Checked for: ${LOCKFILES.join(", ")}.`,
          },
          repair: {
            objective:
              "Generate the lockfile for the repository's selected package manager and verify the existing test commands.",
            allowedPaths: [manifestPath, ...LOCKFILES.map(pathFor)],
            automaticCandidate: true,
          },
        } satisfies RepositoryFinding,
      ];
    });
}

async function inspectSourceFile(
  repositoryPath: string,
  path: string,
): Promise<RepositoryFinding[]> {
  if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) return [];

  const absolutePath = join(repositoryPath, path);
  const metadata = await stat(absolutePath);
  if (metadata.size > 2 * 1024 * 1024) {
    return [
      {
        id: findingId("oversized-source-file", path),
        detector: "oversized-source-file",
        category: "maintainability",
        severity: "medium",
        title: "Source file is unusually large",
        summary: `${path} is larger than 2 MiB and cannot be inspected safely as ordinary source.`,
        evidence: {
          path,
          detail: `File size: ${metadata.size} bytes.`,
        },
        repair: {
          objective:
            "Determine whether this file is generated; otherwise split it along existing module boundaries.",
          allowedPaths: [path],
          automaticCandidate: false,
        },
      },
    ];
  }

  const source = await readFile(absolutePath, "utf8");
  const lines = source.split(/\r?\n/);
  const findings: RepositoryFinding[] = [];

  if (lines.length > LARGE_SOURCE_LINES) {
    findings.push({
      id: findingId("large-source-file", path),
      detector: "large-source-file",
      category: "maintainability",
      severity: "low",
      title: "Source file has crossed the review-size threshold",
      summary: `${path} contains ${lines.length} lines.`,
      evidence: {
        path,
        detail: `Threshold: ${LARGE_SOURCE_LINES} lines.`,
      },
      repair: {
        objective:
          "Review the file for cohesive module boundaries without changing behavior.",
        allowedPaths: [path],
        automaticCandidate: false,
      },
    });
  }

  return findings;
}

async function detectUnpinnedActions(
  repositoryPath: string,
  files: string[],
): Promise<RepositoryFinding[]> {
  const workflowFiles = files.filter(
    (f) => f.startsWith(".github/workflows/") && (f.endsWith(".yml") || f.endsWith(".yaml")),
  );
  const findings: RepositoryFinding[] = [];
  for (const path of workflowFiles) {
    try {
      const content = await readFile(join(repositoryPath, path), "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/uses:\s*([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)@([^\s]+)/);
        if (match) {
          const actionRef = match[2];
          if (!/^[0-9a-f]{40}$/i.test(actionRef)) {
            findings.push({
              id: findingId("unpinned-github-action", path, i + 1),
              detector: "unpinned-github-action",
              category: "security",
              severity: "low",
              title: "GitHub Action ref is not pinned to a commit SHA",
              summary: `${path}:${i + 1} uses ${match[1]}@${actionRef}. Mutable tags can change upstream.`,
              evidence: {
                path,
                line: i + 1,
                detail: `Action uses mutable ref '${actionRef}' instead of an immutable 40-character commit SHA.`,
              },
              repair: {
                objective: `Pin ${match[1]} to an immutable commit SHA.`,
                allowedPaths: [path],
                automaticCandidate: false,
              },
            });
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  return findings;
}

async function detectDockerfileSecurity(
  repositoryPath: string,
  files: string[],
): Promise<RepositoryFinding[]> {
  const dockerfiles = files.filter((f) => basename(f) === "Dockerfile" || f.endsWith(".Dockerfile"));
  const findings: RepositoryFinding[] = [];
  for (const path of dockerfiles) {
    try {
      const content = await readFile(join(repositoryPath, path), "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*FROM\s+\S+:latest\b/i.test(line)) {
          findings.push({
            id: findingId("unpinned-docker-base-image", path, i + 1),
            detector: "unpinned-docker-base-image",
            category: "security",
            severity: "low",
            title: "Dockerfile base image uses unpinned ':latest' tag",
            summary: `${path}:${i + 1} specifies ':latest' base image tag.`,
            evidence: {
              path,
              line: i + 1,
              detail: `Line '${line.trim()}' uses the non-reproducible ':latest' tag.`,
            },
            repair: {
              objective: "Pin the base image to a specific version or digest hash.",
              allowedPaths: [path],
              automaticCandidate: false,
            },
          });
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  return findings;
}

async function detectFailedOathChecks(
  repositoryPath: string,
  now?: () => Date,
  maintenanceReceipt?: MaintenanceReceipt,
): Promise<RepositoryFinding[]> {
  try {
    await stat(join(repositoryPath, "software-oath.yml"));
  } catch {
    return [];
  }

  const receipt =
    maintenanceReceipt ??
    (await runMaintenance({
      repositoryPath,
      writeReceipt: false,
      now,
    }));

  return receipt.report.rules.flatMap((evaluation) => {
    if (evaluation.status !== "failed") return [];
    const failed = evaluation.evidence.find(
      ({ status }) => status === "failed",
    );
    const allowedPaths = evaluation.rule.repair?.allowedPaths ?? [];
    return [
      {
        id: findingId("oath-check-failure", evaluation.rule.id),
        detector: "oath-check-failure",
        category: "maintainability",
        severity: evaluation.rule.severity,
        title: `${evaluation.rule.title} is failing`,
        summary: evaluation.reason,
        evidence: {
          detail:
            failed?.summary ??
            "The repository did not provide passing evidence for this promise.",
        },
        repair: {
          objective: `Restore this application promise without weakening it: ${evaluation.rule.description}`,
          allowedPaths,
          automaticCandidate:
            evaluation.rule.repair?.automaticCandidate === true &&
            allowedPaths.length > 0,
        },
      } satisfies RepositoryFinding,
    ];
  });
}

function summarize(findings: RepositoryFinding[]): InspectionReport["summary"] {
  return {
    total: findings.length,
    critical: findings.filter(({ severity }) => severity === "critical").length,
    high: findings.filter(({ severity }) => severity === "high").length,
    medium: findings.filter(({ severity }) => severity === "medium").length,
    low: findings.filter(({ severity }) => severity === "low").length,
    automaticCandidates: findings.filter(
      ({ repair }) => repair.automaticCandidate,
    ).length,
  };
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

export async function inspectRepository(
  options: InspectOptions,
): Promise<InspectionReport> {
  const repositoryPath = resolve(options.repositoryPath);
  const files = await trackedFiles(repositoryPath);
  const sourceFindings = await Promise.all(
    files.map((path) => inspectSourceFile(repositoryPath, path)),
  );
  const oathFindings =
    options.includeOathChecks === false
      ? []
      : await detectFailedOathChecks(
          repositoryPath,
          options.now,
          options.maintenanceReceipt,
        );
  const adapterAnalysis = options.includeDependencyChecks
    ? await analyzeWithAdapters({
        repositoryPath,
        files,
        now: options.now,
        allowMajorPackageUpdates: options.allowMajorPackageUpdates,
        dependencyCommandRunner: options.dependencyCommandRunner,
      })
    : undefined;
  const unpinnedActions = await detectUnpinnedActions(repositoryPath, files);
  const dockerfileFindings = await detectDockerfileSecurity(repositoryPath, files);
  const findings = [
    ...oathFindings,
    ...(adapterAnalysis?.findings ?? []),
    ...detectSecretFiles(files),
    ...detectPackageLock(files),
    ...unpinnedActions,
    ...dockerfileFindings,
    ...sourceFindings.flat(),
  ].sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      (left.evidence.path ?? "").localeCompare(right.evidence.path ?? "") ||
      (left.evidence.line ?? 0) - (right.evidence.line ?? 0),
  );

  return {
    version: 1,
    repositoryPath,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    summary: summarize(findings),
    findings,
    capabilities: adapterAnalysis?.plan,
  };
}

export function formatInspectionReport(report: InspectionReport): string {
  const lines = [
    `Software Oath inspection · ${basename(report.repositoryPath)}`,
    `Findings: ${report.summary.total} (${report.summary.critical} critical, ${report.summary.high} high, ${report.summary.medium} medium, ${report.summary.low} low)`,
  ];

  if (report.findings.length === 0) {
    lines.push("", "No deterministic maintenance problems were detected.");
  } else {
    for (const finding of report.findings) {
      const location = finding.evidence.path
        ? ` · ${relative(report.repositoryPath, join(report.repositoryPath, finding.evidence.path))}${finding.evidence.line ? `:${finding.evidence.line}` : ""}`
        : "";
      lines.push(
        "",
        `[${finding.severity}] ${finding.title}${location}`,
        `  ${finding.summary}`,
        `  Repair scope: ${finding.repair.allowedPaths.join(", ")}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

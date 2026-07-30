import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type {
  InspectionReport,
  RepositoryFinding,
} from "./types";

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
const MARKER_PATTERN = /\b(TODO|FIXME|HACK)\b(?::|\s|-)*(.*)/i;
const LARGE_SOURCE_LINES = 1_000;
const MAX_MARKER_FINDINGS = 25;

interface InspectOptions {
  repositoryPath: string;
  now?: () => Date;
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

async function detectPackageLock(
  repositoryPath: string,
  files: string[],
): Promise<RepositoryFinding[]> {
  if (!files.includes("package.json")) return [];
  if (LOCKFILES.some((lockfile) => files.includes(lockfile))) return [];

  return [
    {
      id: "package-lockfile-missing",
      detector: "package-lockfile",
      category: "dependencies",
      severity: "high",
      title: "JavaScript dependencies are not locked",
      summary:
        "package.json is tracked, but no supported package-manager lockfile is tracked.",
      evidence: {
        path: "package.json",
        detail: `Checked for: ${LOCKFILES.join(", ")}.`,
      },
      repair: {
        objective:
          "Generate the lockfile for the repository's selected package manager and verify the existing test commands.",
        allowedPaths: ["package.json", ...LOCKFILES],
        automaticCandidate: true,
      },
    },
  ];
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

  for (const [index, line] of lines.entries()) {
    const marker = line.match(MARKER_PATTERN);
    if (!marker) continue;
    const detail = marker[2]?.trim();
    findings.push({
      id: findingId("maintenance-marker", path, index + 1),
      detector: "maintenance-marker",
      category: "maintainability",
      severity: "low",
      title: `${marker[1].toUpperCase()} maintenance marker remains unresolved`,
      summary: detail || "The source contains an unresolved maintenance marker.",
      evidence: {
        path,
        line: index + 1,
        detail: line.trim(),
      },
      repair: {
        objective:
          "Resolve the documented maintenance task or replace the marker with a tracked issue reference.",
        allowedPaths: [path],
        automaticCandidate: false,
      },
    });
    if (
      findings.filter((finding) => finding.detector === "maintenance-marker")
        .length >= MAX_MARKER_FINDINGS
    ) {
      break;
    }
  }

  return findings;
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
  const findings = [
    ...detectSecretFiles(files),
    ...(await detectPackageLock(repositoryPath, files)),
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

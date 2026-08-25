import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { detectResend } from "./resend.js";
import type {
  CapabilityEvidenceV1,
  EvidenceConfidence,
  OptimizerSignalKind,
  OptimizerSignalV1,
  ServiceObservationV1,
} from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 20 * 1_048_576;
const sourceExtensions = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs",
]);
const environmentTemplates = new Set([
  ".env.example", ".env.template", ".env.sample",
]);

export interface StaticRepositoryAnalysisV1 {
  version: 1;
  commit: string;
  filesAnalyzed: number;
  bytesAnalyzed: number;
  observations: ServiceObservationV1[];
  capabilities: CapabilityEvidenceV1[];
  unknowns: string[];
  signals: OptimizerSignalV1[];
  warnings: string[];
  analyzerVersion: string;
}

function shouldAnalyze(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return (
    path.endsWith("package.json") ||
    environmentTemplates.has(name) ||
    sourceExtensions.has(extname(path)) ||
    path.endsWith(".tf") ||
    /^(?:docker-)?compose\.ya?ml$/.test(name)
  );
}

function lineAt(source: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function evidence(options: {
  kind: OptimizerSignalKind;
  value: string;
  file: string;
  source: string;
  offset: number;
  confidence: EvidenceConfidence;
  reason: string;
}): OptimizerSignalV1 {
  return {
    version: 1,
    kind: options.kind,
    value: options.value,
    evidence: {
      version: 1,
      provenance: "observed",
      confidence: options.confidence,
      file: options.file,
      lineStart: lineAt(options.source, options.offset),
      reason: options.reason,
    },
  };
}

function maskComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (value, prefix: string) =>
      prefix + " ".repeat(value.length - prefix.length))
    .replace(/#[^\n]*/g, (value) => " ".repeat(value.length));
}

function packageSignals(path: string, source: string): OptimizerSignalV1[] {
  if (!path.endsWith("package.json")) return [];
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    const groups = ["dependencies", "optionalDependencies", "peerDependencies"];
    return groups.flatMap((group) => {
      const dependencies = value[group];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
        return [];
      }
      return Object.keys(dependencies).sort().map((name) =>
        evidence({
          kind: "manifest_dependency",
          value: name,
          file: path,
          source,
          offset: source.indexOf(JSON.stringify(name)),
          confidence: "medium",
          reason: "Tracked runtime manifest declares this dependency.",
        }));
    });
  } catch {
    return [];
  }
}

function environmentSignals(path: string, source: string): OptimizerSignalV1[] {
  if (!environmentTemplates.has(path.split("/").at(-1) ?? "")) return [];
  return [...source.matchAll(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) =>
    evidence({
      kind: "environment_name",
      value: match[1],
      file: path,
      source,
      offset: match.index,
      confidence: "medium",
      reason: "Tracked environment template declares this variable name; its value was not read.",
    }));
}

function sourceSignals(path: string, source: string): OptimizerSignalV1[] {
  if (!sourceExtensions.has(extname(path))) return [];
  const masked = maskComments(source);
  const patterns: Array<{
    kind: OptimizerSignalKind;
    expression: RegExp;
    value: (match: RegExpMatchArray) => string;
    confidence: EvidenceConfidence;
    reason: string;
  }> = [
    {
      kind: "active_import",
      expression: /(?:import[\s\S]*?\sfrom\s*|require\s*\()\s*["']([^"'./][^"']*)["']/g,
      value: (match) => match[1],
      confidence: "high",
      reason: "Executable source imports this external package.",
    },
    {
      kind: "environment_name",
      expression: /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g,
      value: (match) => match[1],
      confidence: "medium",
      reason: "Executable source references this environment-variable name; its value was not read.",
    },
    {
      kind: "api_hostname",
      expression: /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[:/"'])/gi,
      value: (match) => match[1].toLowerCase(),
      confidence: "high",
      reason: "Executable source contains this API hostname.",
    },
    {
      kind: "runtime_call",
      expression: /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){1,4})\s*\(/g,
      value: (match) => match[1],
      confidence: "very_high",
      reason: "Executable source invokes this qualified runtime call.",
    },
  ];
  return patterns.flatMap((pattern) =>
    [...masked.matchAll(pattern.expression)].map((match) =>
      evidence({
        kind: pattern.kind,
        value: pattern.value(match),
        file: path,
        source,
        offset: match.index,
        confidence: pattern.confidence,
        reason: pattern.reason,
      })));
}

function infrastructureSignals(path: string, source: string): OptimizerSignalV1[] {
  const matches: OptimizerSignalV1[] = [];
  if (path.endsWith(".tf")) {
    for (const match of source.matchAll(/\b(?:resource|data)\s+"([^"]+)"/g)) {
      matches.push(evidence({
        kind: "infrastructure_declaration",
        value: match[1],
        file: path,
        source,
        offset: match.index,
        confidence: "high",
        reason: "Tracked Terraform declares this external resource type.",
      }));
    }
  }
  if (/^(?:docker-)?compose\.ya?ml$/.test(path.split("/").at(-1) ?? "")) {
    for (const match of source.matchAll(/^\s*image:\s*([^\s#]+)/gm)) {
      matches.push(evidence({
        kind: "infrastructure_declaration",
        value: match[1],
        file: path,
        source,
        offset: match.index,
        confidence: "medium",
        reason: "Tracked Compose configuration declares this image.",
      }));
    }
  }
  return matches;
}

function safeTrackedPath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error("Git returned an unsafe tracked path.");
  }
  const target = resolve(root, path);
  if (relative(root, target).startsWith("..")) {
    throw new Error("Tracked path escaped the repository.");
  }
  return target;
}

function deduplicate(signals: OptimizerSignalV1[]): OptimizerSignalV1[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = [
      signal.kind,
      signal.value,
      signal.evidence.file,
      signal.evidence.lineStart,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function analyzeRepositoryStatic(options: {
  repositoryPath: string;
  analyzerVersion?: string;
  repositorySnapshot?: { files: string[]; commit: string };
}): Promise<StaticRepositoryAnalysisV1> {
  const root = await realpath(resolve(options.repositoryPath));
  const [commit, paths] = options.repositorySnapshot
    ? [options.repositorySnapshot.commit, options.repositorySnapshot.files]
    : await Promise.all([
        execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })
          .then(({ stdout }) => stdout),
        execFileAsync("git", ["ls-files", "-z"], {
          cwd: root,
          maxBuffer: 20 * 1_048_576,
        }).then(({ stdout }) => stdout.split("\0").filter(Boolean)),
      ]);
  if (paths.length > MAX_FILES) {
    throw new Error("Optimizer static analysis exceeds the 5,000-file O1 limit.");
  }

  const warnings: string[] = [];
  const signals: OptimizerSignalV1[] = [];
  const sources = new Map<string, string>();
  let filesAnalyzed = 0;
  let bytesAnalyzed = 0;
  for (const path of paths) {
    const target = safeTrackedPath(root, path);
    if (!shouldAnalyze(path)) continue;
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      warnings.push("Skipped symbolic link " + path + ".");
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES) {
      warnings.push("Skipped oversized file " + path + ".");
      continue;
    }
    bytesAnalyzed += stat.size;
    if (bytesAnalyzed > MAX_TOTAL_BYTES) {
      throw new Error("Optimizer static analysis exceeds the 20 MiB O1 limit.");
    }
    const source = await readFile(target, "utf8").catch(() => undefined);
    if (source === undefined || source.includes("\0")) {
      warnings.push("Skipped non-text file " + path + ".");
      continue;
    }
    if (sourceExtensions.has(extname(path))) {
      sources.set(path, source);
    }
    filesAnalyzed += 1;
    signals.push(
      ...packageSignals(path, source),
      ...environmentSignals(path, source),
      ...sourceSignals(path, source),
      ...infrastructureSignals(path, source),
    );
  }

  const resend = detectResend({
    commit: commit.trim(),
    signals: deduplicate(signals),
    sources,
  });
  return {
    version: 1,
    commit: commit.trim(),
    filesAnalyzed,
    bytesAnalyzed,
    signals: deduplicate(signals),
    observations: resend.observation ? [resend.observation] : [],
    capabilities: resend.capabilities,
    unknowns: resend.unknowns,
    warnings,
    analyzerVersion: options.analyzerVersion ?? "optimizer-static-o1",
  };
}

export function staticAnalysisDigest(analysis: StaticRepositoryAnalysisV1): string {
  return createHash("sha256").update(JSON.stringify(analysis)).digest("hex");
}

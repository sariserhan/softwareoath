import { gunzipSync } from "node:zlib";

import type { TrustedRunner } from "../runner/types.js";
import type { StaticRepositoryAnalysisV1 } from "./analyze.js";

const ANALYZER_COMMAND = "tsx /opt/software-oath/scripts/optimizer-analyze.ts";

export async function analyzeRepositoryIsolated(options: {
  repositoryPath: string;
  runner: TrustedRunner;
}): Promise<StaticRepositoryAnalysisV1> {
  const result = await options.runner.execute({
    command: ANALYZER_COMMAND,
    workspacePath: options.repositoryPath,
    timeoutMs: 2 * 60_000,
    readOnly: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Isolated optimizer analyzer exited with code ${result.exitCode ?? "unknown"}: ${result.output}`,
    );
  }
  let analysis: Partial<StaticRepositoryAnalysisV1>;
  try {
    const prefix = "SOFTWARE_OATH_ANALYSIS_GZIP_V1:";
    const serialized = result.output.startsWith(prefix)
      ? gunzipSync(
          Buffer.from(result.output.slice(prefix.length).trim(), "base64"),
          { maxOutputLength: 32 * 1_048_576 },
        )
          .toString("utf8")
      : result.output;
    analysis = JSON.parse(serialized) as Partial<StaticRepositoryAnalysisV1>;
  } catch {
    throw new Error("Isolated optimizer analyzer returned invalid JSON.");
  }
  if (
    analysis.version !== 1 ||
    typeof analysis.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(analysis.commit) ||
    !Number.isSafeInteger(analysis.filesAnalyzed) ||
    !Number.isSafeInteger(analysis.bytesAnalyzed) ||
    !Array.isArray(analysis.signals) ||
    !Array.isArray(analysis.observations) ||
    !Array.isArray(analysis.capabilities) ||
    !Array.isArray(analysis.unknowns) ||
    !Array.isArray(analysis.warnings) ||
    typeof analysis.analyzerVersion !== "string"
  ) {
    throw new Error("Isolated optimizer analyzer returned an invalid result.");
  }
  return analysis as StaticRepositoryAnalysisV1;
}

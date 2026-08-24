import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { analyzeRepositoryStatic } from "../src/optimizer/analyze";
import {
  summarizePublicEvaluation,
  validatePublicEvaluationSet,
  type PublicRepositoryEvaluationSetV1,
  type PublicRepositoryResultV1,
} from "../src/optimizer/public-evaluation";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const manifestPath = resolve(
    "fixtures/optimizer/public-repositories.json",
  );
  const evaluation = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as PublicRepositoryEvaluationSetV1;
  validatePublicEvaluationSet(evaluation);

  const root = await mkdtemp(join(tmpdir(), "software-oath-public-evaluation-"));
  const results: PublicRepositoryResultV1[] = [];
  try {
    for (const [index, item] of evaluation.repositories.entries()) {
      const checkout = join(root, String(index));
      try {
        await execFileAsync(
          "git",
          [
            "clone",
            "--quiet",
            "--filter=blob:none",
            "--no-checkout",
            "https://github.com/" + item.repository + ".git",
            checkout,
          ],
          { maxBuffer: 20 * 1_048_576 },
        );
        await execFileAsync(
          "git",
          ["checkout", "--quiet", item.commit],
          { cwd: checkout, maxBuffer: 20 * 1_048_576 },
        );
        const analysis = await analyzeRepositoryStatic({
          repositoryPath: checkout,
          analyzerVersion: "optimizer-public-o2",
        });
        results.push({
          repository: item.repository,
          commit: analysis.commit,
          actualStatus: analysis.observations.find(
            (observation) => observation.serviceId === evaluation.serviceId,
          )?.status ?? "inactive",
          actualCapabilities: analysis.capabilities
            .filter((capability) => capability.serviceId === evaluation.serviceId)
            .map((capability) => capability.capabilityId)
            .sort(),
        });
      } catch (error) {
        results.push({
          repository: item.repository,
          commit: item.commit,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const summary = summarizePublicEvaluation(evaluation.repositories, results);
  process.stdout.write(JSON.stringify({
    version: 1,
    reviewedAt: evaluation.reviewedAt,
    serviceId: evaluation.serviceId,
    summary,
    results,
  }, null, 2) + "\n");
  if (!summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.stack ?? error.message : String(error)) + "\n",
  );
  process.exitCode = 1;
});

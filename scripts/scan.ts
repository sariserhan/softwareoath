import process from "node:process";

import { scanRepositoryMemory } from "../src/steward/memory";

const args = process.argv.slice(2);
const json = args.includes("--json");
const memoryIndex = args.indexOf("--memory");
const memoryPath = memoryIndex >= 0 ? args.at(memoryIndex + 1) : undefined;
const repositoryPath =
  args.find(
    (argument, index) =>
      !argument.startsWith("--") && index !== memoryIndex + 1,
  ) ?? ".";

try {
  const memory = await scanRepositoryMemory({ repositoryPath, memoryPath });
  process.stdout.write(
    json
      ? `${JSON.stringify(memory, null, 2)}\n`
      : [
          `Software Oath memory updated for ${memory.repository}`,
          `Commit: ${memory.commit}`,
          `Tracked files: ${memory.inventory.trackedFiles}`,
          `Active adapters: ${memory.capabilities?.activeAdapters.join(", ") || "none"}`,
          `Coverage gaps: ${memory.capabilities?.coverageGaps.length ?? 0}`,
          `Findings: ${memory.health.total}`,
          `Scan: ${memory.scanCount}`,
          "",
        ].join("\n"),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

import process from "node:process";

import { DockerTrustedRunner } from "../src/runner/docker";
import { formatReplayReport, runReplay } from "../src/replay/run";

const args = process.argv.slice(2);
const json = args.includes("--json");
const dockerIndex = args.indexOf("--docker-image");
const dockerImage = dockerIndex >= 0 ? args.at(dockerIndex + 1) : undefined;
const positional = args.filter(
  (argument, index) =>
    !argument.startsWith("--") &&
    (dockerIndex < 0 || index !== dockerIndex + 1),
);
const repositoryPath = positional[0] ?? ".";
const specPath = positional[1];

if (!specPath) {
  console.error("Usage: software-oath replay <repository> <incident.yml>");
  process.exit(2);
}

try {
  const report = await runReplay({
    repositoryPath,
    specPath,
    runner: dockerImage
      ? new DockerTrustedRunner({ image: dockerImage })
      : undefined,
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : formatReplayReport(report),
  );
  if (report.verdict === "failed") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

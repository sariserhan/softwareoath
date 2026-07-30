import { appendFile, readFile } from "node:fs/promises";
import process from "node:process";

import { prepareExternalRepair } from "../src/repair/external";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-dir");
const outputDirectory = args.at(outputIndex + 1);
const repositoryPath = args.find(
  (argument, index) =>
    !argument.startsWith("--") && index !== outputIndex + 1,
) ?? ".";

if (!outputDirectory) {
  console.error("--output-dir is required");
  process.exit(2);
}

try {
  const result = await prepareExternalRepair({
    repositoryPath,
    outputDirectory,
  });
  if (process.env.GITHUB_OUTPUT) {
    const values =
      result.status === "prepared"
        ? {
            "has-candidate": "true",
            "repair-id": result.context.id,
            "prompt-file": result.promptPath,
            "context-file": result.contextPath,
          }
        : { "has-candidate": "false" };
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `${Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
    );
    if (result.status === "prepared") {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `prompt<<SOFTWARE_OATH_PROMPT\n${await readFile(result.promptPath, "utf8")}\nSOFTWARE_OATH_PROMPT\n`,
      );
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

import process from "node:process";

import { githubAppManifest } from "../src/integrations/github.js";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: software-oath github-manifest <https://your-domain>");
  process.exit(2);
}

try {
  process.stdout.write(`${JSON.stringify(githubAppManifest(baseUrl), null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { GitHubAppClient } from "../src/integrations/github.js";
import { SecretBox } from "../src/integrations/secrets.js";

const code = process.argv[2];
const masterKey = process.env.SOFTWARE_OATH_MASTER_KEY;
const outputPath = resolve(
  process.env.SOFTWARE_OATH_GITHUB_CONFIG ??
    ".software-oath/github-app.json",
);
if (!code || !masterKey) {
  console.error(
    "Usage: SOFTWARE_OATH_MASTER_KEY=<base64-32-byte-key> software-oath github-convert <manifest-code>",
  );
  process.exit(2);
}

const client = new GitHubAppClient({ appId: "", privateKey: "" });
const converted = await client.convertManifestCode(code);
const box = new SecretBox(masterKey);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      version: 1,
      appId: String(converted.id),
      slug: converted.slug,
      clientId: converted.client_id,
      clientSecret: box.encrypt(converted.client_secret),
      webhookSecret: box.encrypt(converted.webhook_secret),
      privateKey: box.encrypt(converted.pem),
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(
  `Encrypted GitHub App configuration written to ${outputPath}\nInstall at https://github.com/apps/${converted.slug}/installations/new\n`,
);

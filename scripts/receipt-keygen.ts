import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const keyId = process.argv[2] ?? `receipt-${new Date().toISOString().slice(0, 10)}`;
const outputPath = resolve(
  process.argv[3] ?? `.software-oath/receipt-key-${keyId}.json`,
);
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ keyId, privateKey, publicKey }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(
  `Generated Ed25519 receipt key ${keyId} at ${outputPath}.\nKeep the private key in a secrets manager and add the public key to SOFTWARE_OATH_RECEIPT_PUBLIC_KEYS.\n`,
);

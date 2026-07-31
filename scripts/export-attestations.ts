import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exportAttestationBundle } from "../src/control-plane/bundle";
import { FileControlPlaneStore } from "../src/control-plane/store";

async function main() {
  const args = process.argv.slice(2);
  let output = "attestation-bundle.json";
  let repository: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      output = args[++i];
    } else if (!args[i].startsWith("-")) {
      repository = args[i];
    }
  }

  const storePath = process.env.CONTROL_PLANE_STORE ?? join(process.cwd(), ".git", "software-oath", "store.json");
  const store = new FileControlPlaneStore(storePath);

  process.stdout.write(`Exporting attestation bundle from ${storePath}...\n`);
  const bundle = await exportAttestationBundle({ store, repository });

  const targetPath = resolve(process.cwd(), output);
  await writeFile(targetPath, JSON.stringify(bundle, null, 2), "utf8");

  process.stdout.write(`✅ Exported attestation bundle to ${targetPath}\n`);
  process.stdout.write(`   Incidents: ${bundle.manifest.counts.incidents}\n`);
  process.stdout.write(`   Final Attestations: ${bundle.manifest.counts.finalAttestations}\n`);
  process.stdout.write(`   Knowledge Records: ${bundle.manifest.counts.knowledgeRecords}\n`);
  process.stdout.write(`   Audit Events: ${bundle.manifest.counts.auditEvents}\n`);
  process.stdout.write(`   Merkle Root: ${bundle.manifest.merkleRoot}\n`);
  if (bundle.manifest.signature) {
    process.stdout.write(`   Signature Key: ${bundle.manifest.signature.keyId}\n`);
  }
}

void main();

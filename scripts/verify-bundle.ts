import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyAttestationBundle, type AttestationBundle } from "../src/control-plane/bundle";

async function main() {
  const fileArg = process.argv[2] ?? "attestation-bundle.json";
  const targetPath = resolve(process.cwd(), fileArg);

  try {
    const content = await readFile(targetPath, "utf8");
    const bundle = JSON.parse(content) as AttestationBundle;

    process.stdout.write(`Verifying attestation bundle at ${targetPath}...\n`);
    const verification = await verifyAttestationBundle(bundle);

    if (verification.valid) {
      process.stdout.write(`✅ BUNDLE VALID AND VERIFIED\n`);
      process.stdout.write(`   Merkle Root: ${bundle.manifest.merkleRoot}\n`);
      process.stdout.write(`   Incidents Verified: ${verification.summary.incidents}\n`);
      process.stdout.write(`   Knowledge Records Verified: ${verification.summary.knowledgeRecords}\n`);
      process.stdout.write(`   Audit Events Verified: ${verification.summary.auditEvents}\n`);
    } else {
      process.stderr.write(`❌ BUNDLE VERIFICATION FAILED\n`);
      process.stderr.write(`   Reason: ${verification.reason ?? "Unknown validation failure"}\n`);
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`❌ Could not read bundle file at ${targetPath}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

void main();

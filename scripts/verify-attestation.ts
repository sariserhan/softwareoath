import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyFinalAttestation } from "../src/control-plane/attestation.js";
import type { FinalAttestation } from "../src/control-plane/types.js";

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) throw new Error("Usage: software-oath verify-attestation <final-attestation.json>");
  const targetPath = resolve(process.cwd(), fileArg);
  const parsed = JSON.parse(await readFile(targetPath, "utf8")) as
    | FinalAttestation
    | { attestation: FinalAttestation };
  const attestation = "attestation" in parsed ? parsed.attestation : parsed;
  verifyFinalAttestation(attestation);
  process.stdout.write(`Final attestation ${attestation.id} is valid and trusted.\n`);
  process.stdout.write(`Run: ${attestation.runId}\nDecision: ${attestation.decision.value}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

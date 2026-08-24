import { randomUUID } from "node:crypto";
import process from "node:process";

import { LocalArtifactStore } from "../src/control-plane/artifacts";
import { RepairOrchestrator } from "../src/control-plane/orchestrator";
import {
  PostgresControlPlaneStore,
  runMigrations,
} from "../src/control-plane/postgres";
import { GitHubAppClient } from "../src/integrations/github";
import { RemoteInfracostScanner } from "../src/integrations/infracost";
import {
  loadGitHubAppSecrets,
  resolveSecret,
} from "../src/integrations/secrets";
import { hostedRunnerFromEnvironment } from "../src/runner/config";
import {
  receiptSignerFromEnvironment,
  trustedReceiptKeysFromEnvironment,
} from "../src/repair/signature";
import { enqueueDueStewardshipRuns } from "../src/steward/schedule";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for the durable worker.");
  process.exit(2);
}
const runner = hostedRunnerFromEnvironment();
const preparationRunner = hostedRunnerFromEnvironment(process.env, "bridge");
const runnerBrokerUrl = process.env.SOFTWARE_OATH_RUNNER_BROKER_URL!;
const runnerBrokerToken = process.env.SOFTWARE_OATH_RUNNER_BROKER_TOKEN!;
const costScanner = new RemoteInfracostScanner({
  baseUrl: runnerBrokerUrl,
  token: runnerBrokerToken,
});
const storedGitHub = await loadGitHubAppSecrets(
  process.env.SOFTWARE_OATH_GITHUB_CONFIG,
  process.env.SOFTWARE_OATH_MASTER_KEY,
).catch((error) => {
  if (process.env.GITHUB_APP_ID) return undefined;
  throw error;
});
const githubPrivateKey = storedGitHub?.privateKey ?? resolveSecret({
  plaintext: process.env.GITHUB_APP_PRIVATE_KEY,
  encrypted: process.env.GITHUB_APP_PRIVATE_KEY_ENCRYPTED,
  masterKey: process.env.SOFTWARE_OATH_MASTER_KEY,
});
const github =
  (storedGitHub?.appId ?? process.env.GITHUB_APP_ID) && githubPrivateKey
    ? new GitHubAppClient({
        appId: storedGitHub?.appId ?? process.env.GITHUB_APP_ID!,
        privateKey: githubPrivateKey.replaceAll("\\n", "\n"),
      })
    : undefined;
const store = PostgresControlPlaneStore.fromConnectionString(databaseUrl);
await runMigrations(store.pool);
const orchestrator = new RepairOrchestrator({
  store,
  workerId: process.env.SOFTWARE_OATH_WORKER_ID ?? `worker-${randomUUID()}`,
  github,
  runner,
  preparationRunner,
  costScanner,
  artifacts: new LocalArtifactStore(
    process.env.SOFTWARE_OATH_ARTIFACT_PATH ?? ".software-oath/artifacts",
  ),
  signer: receiptSignerFromEnvironment(),
  trustedKeys: trustedReceiptKeysFromEnvironment(),
  publicUrl: process.env.SOFTWARE_OATH_PUBLIC_URL,
});

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

while (!stopping) {
  await enqueueDueStewardshipRuns(store);
  await orchestrator.monitorCi();
  const processed = await orchestrator.processNext();
  if (!processed) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
await store.pool.end();

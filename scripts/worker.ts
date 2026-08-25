import { randomUUID } from "node:crypto";
import process from "node:process";

import { artifactStoreFromEnvironment } from "../src/control-plane/artifact-config";
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
const workerId = process.env.SOFTWARE_OATH_WORKER_ID ?? `worker-${randomUUID()}`;
const heartbeat = (status: "ready" | "stopping") => store.upsertHeartbeat({
  service: "worker", instanceId: workerId, status,
  observedAt: new Date().toISOString(),
});
await heartbeat("ready");
const heartbeatTimer = setInterval(() => {
  void heartbeat("ready").catch((error) => {
    process.stderr.write(JSON.stringify({ level: "error",
      event: "worker.heartbeat_failed", workerId,
      error: error instanceof Error ? error.message : String(error) }) + "\n");
  });
}, Number(process.env.SOFTWARE_OATH_HEARTBEAT_INTERVAL_MS ?? 10_000));
heartbeatTimer.unref();
const orchestrator = new RepairOrchestrator({
  store,
  workerId,
  github,
  runner,
  preparationRunner,
  costScanner,
  artifacts: artifactStoreFromEnvironment(),
  optimizerAnalysisEnabled:
    process.env.SOFTWARE_OATH_OPTIMIZER_ANALYSIS_ENABLED === "true",
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
clearInterval(heartbeatTimer);
await heartbeat("stopping");
await store.pool.end();

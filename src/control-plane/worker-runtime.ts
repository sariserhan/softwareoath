import { randomUUID } from "node:crypto";

import { GitHubAppClient } from "../integrations/github";
import { RemoteInfracostScanner } from "../integrations/infracost";
import { loadGitHubAppSecrets, resolveSecret } from "../integrations/secrets";
import { hostedRunnerFromEnvironment } from "../runner/config";
import {
  receiptSignerFromEnvironment,
  trustedReceiptKeysFromEnvironment,
} from "../repair/signature";
import { artifactStoreFromEnvironment } from "./artifact-config";
import { RepairOrchestrator } from "./orchestrator";
import { PostgresControlPlaneStore, runMigrations } from "./postgres";

export interface WorkerRuntime {
  store: PostgresControlPlaneStore;
  orchestrator: RepairOrchestrator;
  close(): Promise<void>;
}

export async function createWorkerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkerRuntime> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for durable job processing.");
  }
  const runnerBrokerUrl = env.SOFTWARE_OATH_RUNNER_BROKER_URL?.trim();
  const runnerBrokerToken = env.SOFTWARE_OATH_RUNNER_BROKER_TOKEN?.trim();
  if (!runnerBrokerUrl || !runnerBrokerToken) {
    throw new Error(
      "The isolated runner configuration is required for job processing.",
    );
  }

  const storedGitHub = await loadGitHubAppSecrets(
    env.SOFTWARE_OATH_GITHUB_CONFIG,
    env.SOFTWARE_OATH_MASTER_KEY,
  ).catch((error) => {
    if (env.GITHUB_APP_ID) return undefined;
    throw error;
  });
  const githubPrivateKey = storedGitHub?.privateKey ?? resolveSecret({
    plaintext: env.GITHUB_APP_PRIVATE_KEY,
    encrypted: env.GITHUB_APP_PRIVATE_KEY_ENCRYPTED,
    masterKey: env.SOFTWARE_OATH_MASTER_KEY,
  });
  const github =
    (storedGitHub?.appId ?? env.GITHUB_APP_ID) && githubPrivateKey
      ? new GitHubAppClient({
          appId: storedGitHub?.appId ?? env.GITHUB_APP_ID!,
          privateKey: githubPrivateKey.replaceAll("\\n", "\n"),
        })
      : undefined;

  const store = PostgresControlPlaneStore.fromConnectionString(env.DATABASE_URL);
  await runMigrations(store.pool);
  const orchestrator = new RepairOrchestrator({
    store,
    workerId: env.SOFTWARE_OATH_WORKER_ID ?? `event-${randomUUID()}`,
    github,
    runner: hostedRunnerFromEnvironment(env),
    preparationRunner: hostedRunnerFromEnvironment(env, "bridge"),
    costScanner: new RemoteInfracostScanner({
      baseUrl: runnerBrokerUrl,
      token: runnerBrokerToken,
    }),
    artifacts: artifactStoreFromEnvironment(env),
    optimizerAnalysisEnabled:
      env.SOFTWARE_OATH_OPTIMIZER_ANALYSIS_ENABLED === "true",
    signer: receiptSignerFromEnvironment(),
    trustedKeys: trustedReceiptKeysFromEnvironment(),
    publicUrl: env.SOFTWARE_OATH_PUBLIC_URL,
  });

  return {
    store,
    orchestrator,
    close: async () => store.pool.end(),
  };
}

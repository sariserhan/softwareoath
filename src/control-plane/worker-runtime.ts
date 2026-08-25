import { randomUUID } from "node:crypto";

import { GitHubAppClient } from "../integrations/github.js";
import { RemoteInfracostScanner } from "../integrations/infracost.js";
import { RunnerInfracostScanner } from "../integrations/sandbox-infracost.js";
import { loadGitHubAppSecrets, resolveSecret } from "../integrations/secrets.js";
import { productionRunnerFromEnvironment } from "../runner/config.js";
import { VercelSandboxTrustedRunner } from "../runner/vercel-sandbox.js";
import {
  receiptSignerFromEnvironment,
  trustedReceiptKeysFromEnvironment,
} from "../repair/signature.js";
import { artifactStoreFromEnvironment } from "./artifact-config.js";
import { RepairOrchestrator } from "./orchestrator.js";
import { PostgresControlPlaneStore, runMigrations } from "./postgres.js";

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
  const sandboxImage = env.SOFTWARE_OATH_SANDBOX_IMAGE?.trim();
  const usingSandbox = env.VERCEL === "1" || Boolean(sandboxImage);
  if (!usingSandbox && (!runnerBrokerUrl || !runnerBrokerToken)) {
    throw new Error("The isolated runner configuration is required for job processing.");
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
  const runner = productionRunnerFromEnvironment(env);
  const preparationRunner = productionRunnerFromEnvironment(env, "bridge");
  const infracostKey = env.INFRACOST_API_KEY?.trim();
  const credentialHeaders: Record<string, string> = infracostKey
    ? { "X-API-Key": infracostKey, Authorization: `Bearer ${infracostKey}` }
    : {};
  const costScanner = usingSandbox
    ? new RunnerInfracostScanner(new VercelSandboxTrustedRunner({
        image: sandboxImage!,
        network: "bridge",
        environment: {
          INFRACOST_API_KEY: "_brokered_",
          INFRACOST_SKIP_UPDATE_CHECK: "true",
        },
        networkPolicy: {
          allow: {
            "pricing.api.infracost.io": [{ transform: [{ headers: credentialHeaders }] }],
            "dashboard.api.infracost.io": [{ transform: [{ headers: credentialHeaders }] }],
            "api.infracost.io": [{ transform: [{ headers: credentialHeaders }] }],
            "*": [],
          },
        },
      }))
    : new RemoteInfracostScanner({
        baseUrl: runnerBrokerUrl!,
        token: runnerBrokerToken!,
      });
  const orchestrator = new RepairOrchestrator({
    store,
    workerId: env.SOFTWARE_OATH_WORKER_ID ?? `event-${randomUUID()}`,
    github,
    runner,
    preparationRunner,
    repositoryGitRunner: usingSandbox
      ? (installationToken) => new VercelSandboxTrustedRunner({
          image: sandboxImage!,
          network: "bridge",
          environment: {
            HOME: "/tmp",
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.extraHeader",
            GIT_CONFIG_VALUE_0:
              "Authorization: Basic eC1hY2Nlc3MtdG9rZW46X2Jyb2tlcmVkXw==",
          },
          networkPolicy: {
            allow: {
              "github.com": [{
                transform: [{
                  headers: {
                    Authorization:
                      `Basic ${Buffer.from(`x-access-token:${installationToken}`).toString("base64")}`,
                  },
                }],
              }],
              "*": [],
            },
          },
        })
      : undefined,
    costScanner,
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

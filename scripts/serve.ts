import { randomUUID } from "node:crypto";
import process from "node:process";

import { createControlPlaneServer } from "../src/control-plane/server.js";
import {
  PostgresControlPlaneStore,
  runMigrations,
} from "../src/control-plane/postgres.js";
import { FileControlPlaneStore } from "../src/control-plane/store.js";
import { artifactStoreFromEnvironment } from "../src/control-plane/artifact-config.js";
import { runDispatcherFromEnvironment } from "../src/control-plane/events.js";
import {
  receiptSignerFromEnvironment,
  trustedReceiptKeysFromEnvironment,
} from "../src/repair/signature.js";
import {
  GitHubReviewerOAuth,
  ReviewerSessions,
} from "../src/control-plane/auth.js";
import { GitHubAppClient } from "../src/integrations/github.js";
import {
  loadGitHubAppSecrets,
  resolveSecret,
} from "../src/integrations/secrets.js";

const port = Number(process.env.PORT ?? 8787);
const dataPath =
  process.env.SOFTWARE_OATH_DATA_PATH ?? ".software-oath/control-plane.json";
const sentrySecret = process.env.SENTRY_CLIENT_SECRET ?? "";
const approvalToken = process.env.SOFTWARE_OATH_APPROVAL_TOKEN ?? "";
const publicUrl = process.env.SOFTWARE_OATH_PUBLIC_URL ?? "";
const githubOAuthClientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? "";
const githubOAuthClientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "";
const masterKey = process.env.SOFTWARE_OATH_MASTER_KEY ?? "";
const sessionSecret = process.env.SOFTWARE_OATH_SESSION_SECRET ?? "";
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
const githubOnboarding =
  (storedGitHub?.appId ?? process.env.GITHUB_APP_ID) && githubPrivateKey
    ? new GitHubAppClient({
        appId: storedGitHub?.appId ?? process.env.GITHUB_APP_ID!,
        privateKey: githubPrivateKey.replaceAll("\\n", "\n"),
      })
    : undefined;

if (
  !approvalToken ||
  !publicUrl ||
  !githubOAuthClientId ||
  !githubOAuthClientSecret ||
  !masterKey ||
  !sessionSecret
) {
  console.error(
    "Operator, GitHub OAuth, public URL, master key, and session secret configuration are required.",
  );
  process.exit(2);
}

const store = process.env.DATABASE_URL
  ? PostgresControlPlaneStore.fromConnectionString(process.env.DATABASE_URL)
  : new FileControlPlaneStore(dataPath);
if (store instanceof PostgresControlPlaneStore) {
  await runMigrations(store.pool);
}

const apiId = process.env.SOFTWARE_OATH_API_ID ?? `api-${randomUUID()}`;
await store.upsertHeartbeat({ service: "api", instanceId: apiId, status: "ready", observedAt: new Date().toISOString() });
const heartbeatTimer = setInterval(() => {
  void store.upsertHeartbeat({ service: "api", instanceId: apiId, status: "ready", observedAt: new Date().toISOString() });
}, Number(process.env.SOFTWARE_OATH_HEARTBEAT_INTERVAL_MS ?? 10_000));
heartbeatTimer.unref();

const server = createControlPlaneServer({
  store,
  sentrySecret,
  genericWebhookSecret: process.env.SOFTWARE_OATH_GENERIC_WEBHOOK_SECRET,
  approvalToken,
  defaultRepository: process.env.SOFTWARE_OATH_REPOSITORY,
  staticDirectory: process.env.SOFTWARE_OATH_STATIC_PATH ?? "dist",
  artifacts: artifactStoreFromEnvironment(),
  signer: receiptSignerFromEnvironment(),
  trustedKeys: trustedReceiptKeysFromEnvironment(),
  reviewerOAuth: new GitHubReviewerOAuth({
    clientId: githubOAuthClientId,
    clientSecret: githubOAuthClientSecret,
    publicUrl,
  }),
  reviewerSessions: new ReviewerSessions({
    store,
    masterKey,
    stateSecret: sessionSecret,
    publicUrl,
  }),
  githubOnboarding,
  runDispatcher: runDispatcherFromEnvironment(),
});
server.listen(port, () => {
  process.stdout.write(JSON.stringify({ level: "info", event: "api.listening", apiId, port }) + "\n");
});
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  await store.upsertHeartbeat({ service: "api", instanceId: apiId, status: "stopping", observedAt: new Date().toISOString() }).catch(() => undefined);
  server.close(async () => {
    if (store instanceof PostgresControlPlaneStore) await store.pool.end();
    process.exit(0);
  });
};
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });

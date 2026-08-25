import type { IncomingMessage, ServerResponse } from "node:http";

import { artifactStoreFromEnvironment } from "../src/control-plane/artifact-config.js";
import { GitHubReviewerOAuth, ReviewerSessions } from "../src/control-plane/auth.js";
import { runDispatcherFromEnvironment } from "../src/control-plane/events.js";
import { PostgresControlPlaneStore, assertDatabaseReady } from "../src/control-plane/postgres.js";
import { createControlPlaneHandler } from "../src/control-plane/server.js";
import { GitHubAppClient } from "../src/integrations/github.js";
import { loadGitHubAppSecrets, resolveSecret } from "../src/integrations/secrets.js";
import {
  receiptSignerFromEnvironment,
  trustedReceiptKeysFromEnvironment,
} from "../src/repair/signature.js";

export const maxDuration = 60;

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

let handlerPromise: Promise<Handler> | undefined;

async function initialize(): Promise<Handler> {
  const required = {
    databaseUrl: process.env.DATABASE_URL,
    approvalToken: process.env.SOFTWARE_OATH_APPROVAL_TOKEN,
    publicUrl: process.env.SOFTWARE_OATH_PUBLIC_URL,
    oauthId: process.env.GITHUB_OAUTH_CLIENT_ID,
    oauthSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
    masterKey: process.env.SOFTWARE_OATH_MASTER_KEY,
    sessionSecret: process.env.SOFTWARE_OATH_SESSION_SECRET,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`The Vercel control-plane environment is incomplete: ${missing.join(", ")}.`);
  }

  const store = PostgresControlPlaneStore.fromConnectionString(required.databaseUrl!);
  await assertDatabaseReady(store.pool);
  const storedGitHub = await loadGitHubAppSecrets(
    process.env.SOFTWARE_OATH_GITHUB_CONFIG,
    required.masterKey,
  ).catch((error) => {
    if (process.env.GITHUB_APP_ID) return undefined;
    throw error;
  });
  const privateKey = storedGitHub?.privateKey ?? resolveSecret({
    plaintext: process.env.GITHUB_APP_PRIVATE_KEY,
    encrypted: process.env.GITHUB_APP_PRIVATE_KEY_ENCRYPTED,
    masterKey: required.masterKey,
  });
  const githubOnboarding =
    (storedGitHub?.appId ?? process.env.GITHUB_APP_ID) && privateKey
      ? new GitHubAppClient({
          appId: storedGitHub?.appId ?? process.env.GITHUB_APP_ID!,
          privateKey: privateKey.replaceAll("\\n", "\n"),
        })
      : undefined;

  return createControlPlaneHandler({
    store,
    approvalToken: required.approvalToken!,
    sentrySecret: process.env.SENTRY_CLIENT_SECRET,
    genericWebhookSecret: process.env.SOFTWARE_OATH_GENERIC_WEBHOOK_SECRET,
    defaultRepository: process.env.SOFTWARE_OATH_REPOSITORY,
    artifacts: artifactStoreFromEnvironment(),
    signer: receiptSignerFromEnvironment(),
    trustedKeys: trustedReceiptKeysFromEnvironment(),
    reviewerOAuth: new GitHubReviewerOAuth({
      clientId: required.oauthId!,
      clientSecret: required.oauthSecret!,
      publicUrl: required.publicUrl!,
    }),
    reviewerSessions: new ReviewerSessions({
      store,
      masterKey: required.masterKey!,
      stateSecret: required.sessionSecret!,
      publicUrl: required.publicUrl!,
    }),
    githubOnboarding,
    runDispatcher: runDispatcherFromEnvironment(),
  });
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  handlerPromise ??= initialize();
  return (await handlerPromise)(request, response);
}

import process from "node:process";

import { createControlPlaneServer } from "../src/control-plane/server";
import {
  PostgresControlPlaneStore,
  runMigrations,
} from "../src/control-plane/postgres";
import { FileControlPlaneStore } from "../src/control-plane/store";
import { LocalArtifactStore } from "../src/control-plane/artifacts";

const port = Number(process.env.PORT ?? 8787);
const dataPath =
  process.env.SOFTWARE_OATH_DATA_PATH ?? ".software-oath/control-plane.json";
const sentrySecret = process.env.SENTRY_CLIENT_SECRET ?? "";
const approvalToken = process.env.SOFTWARE_OATH_APPROVAL_TOKEN ?? "";

if (!sentrySecret || !approvalToken) {
  console.error(
    "SENTRY_CLIENT_SECRET and SOFTWARE_OATH_APPROVAL_TOKEN are required.",
  );
  process.exit(2);
}

const store = process.env.DATABASE_URL
  ? PostgresControlPlaneStore.fromConnectionString(process.env.DATABASE_URL)
  : new FileControlPlaneStore(dataPath);
if (store instanceof PostgresControlPlaneStore) {
  await runMigrations(store.pool);
}

createControlPlaneServer({
  store,
  sentrySecret,
  approvalToken,
  defaultRepository: process.env.SOFTWARE_OATH_REPOSITORY,
  staticDirectory: process.env.SOFTWARE_OATH_STATIC_PATH ?? "dist",
  artifacts: new LocalArtifactStore(
    process.env.SOFTWARE_OATH_ARTIFACT_PATH ?? ".software-oath/artifacts",
  ),
}).listen(port, () => {
  process.stdout.write(`Software Oath control plane listening on :${port}\n`);
});

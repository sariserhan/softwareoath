import process from "node:process";

import { createControlPlaneServer } from "../src/control-plane/server";
import { FileControlPlaneStore } from "../src/control-plane/store";

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

createControlPlaneServer({
  store: new FileControlPlaneStore(dataPath),
  sentrySecret,
  approvalToken,
  defaultRepository: process.env.SOFTWARE_OATH_REPOSITORY,
}).listen(port, () => {
  process.stdout.write(`Software Oath control plane listening on :${port}\n`);
});

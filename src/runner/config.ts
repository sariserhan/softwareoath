import { RemoteTrustedRunner } from "./remote.js";

export function hostedRunnerFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  network: "none" | "bridge" = "none",
): RemoteTrustedRunner {
  const baseUrl = env.SOFTWARE_OATH_RUNNER_BROKER_URL?.trim();
  const token = env.SOFTWARE_OATH_RUNNER_BROKER_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new Error(
      "SOFTWARE_OATH_RUNNER_BROKER_URL and SOFTWARE_OATH_RUNNER_BROKER_TOKEN are required; hosted execution will not fall back to the worker process.",
    );
  }
  return new RemoteTrustedRunner({ baseUrl, token, network });
}

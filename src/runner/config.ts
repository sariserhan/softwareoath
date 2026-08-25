import { RemoteTrustedRunner } from "./remote.js";
import { VercelSandboxTrustedRunner } from "./vercel-sandbox.js";

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

export function productionRunnerFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  network: "none" | "bridge" = "none",
): RemoteTrustedRunner | VercelSandboxTrustedRunner {
  const sandboxImage = env.SOFTWARE_OATH_SANDBOX_IMAGE?.trim();
  if (env.VERCEL === "1" || sandboxImage) {
    if (!sandboxImage) {
      throw new Error("SOFTWARE_OATH_SANDBOX_IMAGE is required on Vercel.");
    }
    return new VercelSandboxTrustedRunner({
      image: sandboxImage,
      network,
      environment:
        network === "bridge"
          ? { HOME: "/tmp", npm_config_cache: "/tmp/npm-cache" }
          : undefined,
    });
  }
  return hostedRunnerFromEnvironment(env, network);
}

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { DockerTrustedRunner } from "../src/runner/docker";

const port = Number(process.env.PORT ?? 8790);
const token = process.env.SOFTWARE_OATH_RUNNER_BROKER_TOKEN?.trim();
const image = process.env.SOFTWARE_OATH_RUNNER_IMAGE?.trim();
const workspaceRoot = process.env.SOFTWARE_OATH_RUNNER_WORKSPACE_ROOT?.trim();
const workspaceVolume = process.env.SOFTWARE_OATH_RUNNER_VOLUME?.trim();
const outputLimit = Number(process.env.SOFTWARE_OATH_RUNNER_OUTPUT_LIMIT ?? 262_144);
if (!token || !image || !workspaceRoot || !workspaceVolume) {
  throw new Error(
    "Runner broker token, image, workspace root, and workspace volume are required.",
  );
}

function authorized(request: IncomingMessage): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const expectedBuffer = Buffer.from(token!);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(value)}\n`);
}

async function body(request: IncomingMessage): Promise<string> {
  let value = "";
  for await (const chunk of request) {
    value += chunk.toString();
    if (value.length > 64_000) throw new Error("Request body is too large.");
  }
  return value;
}

function runner(network: "none" | "bridge"): DockerTrustedRunner {
  return new DockerTrustedRunner({
    image: image!,
    workspaceRoot: workspaceRoot!,
    workspaceVolume: workspaceVolume!,
    outputLimit,
    network,
  });
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ok" });
      return;
    }
    if (!authorized(request)) {
      json(response, 401, { error: "Runner broker authentication required." });
      return;
    }
    if (request.method === "GET" && request.url === "/identity") {
      json(response, 200, { identity: await runner("none").identity() });
      return;
    }
    if (request.method === "POST" && request.url === "/execute") {
      const payload = JSON.parse(await body(request)) as {
        command?: unknown;
        workspacePath?: unknown;
        timeoutMs?: unknown;
        network?: unknown;
      };
      const command = typeof payload.command === "string" ? payload.command : "";
      const workspacePath =
        typeof payload.workspacePath === "string" ? payload.workspacePath : "";
      const timeoutMs = Number(payload.timeoutMs);
      const network = payload.network === "bridge" ? "bridge" : "none";
      if (
        !command ||
        !workspacePath ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 10 * 60 * 1_000
      ) {
        json(response, 400, { error: "Invalid runner execution request." });
        return;
      }
      json(response, 200, await runner(network).execute({
        command,
        workspacePath,
        timeoutMs,
      }));
      return;
    }
    json(response, 404, { error: "Not found." });
  } catch (error) {
    json(response, 500, {
      error: error instanceof Error ? error.message : "Runner broker failed.",
    });
  }
}).listen(port, () => {
  process.stdout.write(`Software Oath runner broker listening on :${port}\n`);
});

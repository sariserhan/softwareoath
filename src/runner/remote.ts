import type { CommandRequest, CommandResult, TrustedRunner } from "./types.js";

export interface RemoteRunnerOptions {
  baseUrl: string;
  token: string;
  network?: "none" | "bridge";
}

export class RemoteTrustedRunner implements TrustedRunner {
  readonly name: string;

  constructor(private readonly options: RemoteRunnerOptions) {
    if (!options.baseUrl.trim() || !options.token.trim()) {
      throw new Error("Runner broker URL and token are required.");
    }
    this.name = `runner-broker:${options.network ?? "none"}`;
  }

  async identity(): Promise<string> {
    const response = await this.request("/identity", { method: "GET" });
    const payload = (await response.json()) as { identity?: unknown };
    if (typeof payload.identity !== "string" || !payload.identity) {
      throw new Error("Runner broker returned an invalid image identity.");
    }
    return payload.identity;
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    const response = await this.request("/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...request,
        network: this.options.network ?? "none",
      }),
      signal: AbortSignal.timeout(request.timeoutMs + 15_000),
    });
    const payload = (await response.json()) as Partial<CommandResult>;
    if (
      (typeof payload.exitCode !== "number" && payload.exitCode !== null) ||
      typeof payload.output !== "string" ||
      typeof payload.durationMs !== "number"
    ) {
      throw new Error("Runner broker returned an invalid execution result.");
    }
    return payload as CommandResult;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(
      `${this.options.baseUrl.replace(/\/$/, "")}${path}`,
      {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${this.options.token}`,
        },
      },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Runner broker request failed with ${response.status}: ${message.slice(0, 500)}`,
      );
    }
    return response;
  }
}

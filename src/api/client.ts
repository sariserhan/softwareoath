export const SOFTWARE_OATH_API_VERSION = "v1";
export const SOFTWARE_OATH_API_MEDIA_TYPE =
  "application/vnd.software-oath.v1+json";

export interface ApiPage<T> {
  items: T[];
  nextCursor?: string;
}

export type ApiErrorKind =
  | "unauthenticated"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "request_failed";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: ApiErrorKind,
    readonly correlationId: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Fetcher = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

export interface ApiClientOptions {
  fetcher?: Fetcher;
  sleep?: Sleep;
  retries?: number;
  createCorrelationId?: () => string;
}

function errorKind(status: number): ApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "request_failed";
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function parsePayload(response: Response): Promise<unknown> {
  const source = await response.text();
  if (!source) return undefined;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new ApiError(
      "The server returned an invalid JSON response.",
      response.status,
      "invalid_response",
      response.headers.get("X-Correlation-ID") ?? "unknown",
      false,
    );
  }
}

let correlationSequence = 0;

function defaultCorrelationId(): string {
  correlationSequence += 1;
  return `web-${Date.now().toString(36)}-${correlationSequence.toString(36)}`;
}

export class SoftwareOathApiClient {
  private readonly fetcher: Fetcher;
  private readonly sleep: Sleep;
  private readonly retries: number;
  private readonly createCorrelationId: () => string;

  constructor(options: ApiClientOptions = {}) {
    this.fetcher =
      options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.retries = options.retries ?? 2;
    this.createCorrelationId =
      options.createCorrelationId ?? defaultCorrelationId;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  getPage<T>(path: string, cursor?: string): Promise<ApiPage<T>> {
    const separator = path.includes("?") ? "&" : "?";
    return this.get<ApiPage<T>>(
      cursor ? `${path}${separator}cursor=${encodeURIComponent(cursor)}` : path,
    );
  }

  post<T>(path: string, payload?: unknown, csrfToken?: string): Promise<T> {
    const headers = new Headers();
    if (payload !== undefined) headers.set("Content-Type", "application/json");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    return this.request<T>(path, {
      method: "POST",
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith("/api/")) {
      throw new Error(`API paths must start with /api/: ${path}`);
    }
    const method = (init.method ?? "GET").toUpperCase();
    const attempts = method === "GET" ? this.retries + 1 : 1;
    const correlationId = this.createCorrelationId();
    const headers = new Headers(init.headers);
    headers.set("Accept", SOFTWARE_OATH_API_MEDIA_TYPE);
    headers.set("X-Software-Oath-API-Version", SOFTWARE_OATH_API_VERSION);
    headers.set("X-Correlation-ID", correlationId);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.fetcher(path, {
          ...init,
          credentials: "same-origin",
          headers,
        });
        const payload = await parsePayload(response);
        if (response.ok) return payload as T;

        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Request failed with status ${response.status}.`;
        const retryable = retryableStatus(response.status);
        const error = new ApiError(
          message,
          response.status,
          errorKind(response.status),
          response.headers.get("X-Correlation-ID") ?? correlationId,
          retryable,
        );
        if (!retryable || attempt === attempts - 1) throw error;
      } catch (error) {
        if (error instanceof ApiError) {
          if (!error.retryable || attempt === attempts - 1) throw error;
        } else if (attempt === attempts - 1) {
          throw new ApiError(
            error instanceof Error ? error.message : "Network request failed.",
            0,
            "unavailable",
            correlationId,
            true,
          );
        }
      }
      await this.sleep(100 * 2 ** attempt);
    }

    throw new Error("API request retry loop exited unexpectedly.");
  }
}

export const apiClient = new SoftwareOathApiClient();

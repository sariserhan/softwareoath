import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  SOFTWARE_OATH_API_MEDIA_TYPE,
  SOFTWARE_OATH_API_VERSION,
  SoftwareOathApiClient,
} from "./client.js";

function response(payload: unknown, status = 200, correlationId = "server-id") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Correlation-ID": correlationId,
    },
  });
}

describe("SoftwareOathApiClient", () => {
  it("sends version, media type, credentials, and correlation ID", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(response({ authenticated: false })),
    );
    const client = new SoftwareOathApiClient({
      fetcher,
      createCorrelationId: () => "client-id",
    });

    await expect(client.get("/api/auth/session")).resolves.toEqual({
      authenticated: false,
    });
    const headers = fetcher.mock.calls[0][1]?.headers as Headers;
    expect(fetcher.mock.calls[0][1]?.credentials).toBe("same-origin");
    expect(headers.get("Accept")).toBe(SOFTWARE_OATH_API_MEDIA_TYPE);
    expect(headers.get("X-Software-Oath-API-Version")).toBe(
      SOFTWARE_OATH_API_VERSION,
    );
    expect(headers.get("X-Correlation-ID")).toBe("client-id");
  });

  it("normalizes failures and preserves server correlation IDs", async () => {
    const client = new SoftwareOathApiClient({
      fetcher: vi.fn(() =>
        Promise.resolve(response({ error: "Owner required." }, 401)),
      ),
    });

    await expect(client.get("/api/repositories")).rejects.toMatchObject({
      name: "ApiError",
      message: "Owner required.",
      status: 401,
      kind: "unauthenticated",
      correlationId: "server-id",
      retryable: false,
    });
  });

  it("retries safe reads but never retries writes", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const readFetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ error: "Busy." }, 503))
      .mockResolvedValueOnce(response({ items: [] }));
    const readClient = new SoftwareOathApiClient({
      fetcher: readFetcher,
      sleep,
    });
    await expect(readClient.get("/api/runs")).resolves.toEqual({ items: [] });
    expect(readFetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);

    const writeFetcher = vi.fn(() =>
      Promise.resolve(response({ error: "Busy." }, 503)),
    );
    const writeClient = new SoftwareOathApiClient({ fetcher: writeFetcher });
    await expect(
      writeClient.post("/api/repositories", { repository: "owner/repo" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(writeFetcher).toHaveBeenCalledTimes(1);
  });

  it("adds encoded cursors to paginated reads", async () => {
    const fetcher = vi.fn(() => Promise.resolve(response({ items: [] })));
    const client = new SoftwareOathApiClient({ fetcher });
    await client.getPage("/api/runs?status=completed", "next page");
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/runs?status=completed&cursor=next%20page",
    );
  });
});

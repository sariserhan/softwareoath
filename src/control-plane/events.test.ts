import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@vercel/queue", () => ({ send }));

import {
  VercelQueueRunDispatcher,
  runDispatcherFromEnvironment,
} from "./events.js";

describe("run event dispatch", () => {
  beforeEach(() => send.mockReset());

  it("is disabled outside Vercel", () => {
    expect(runDispatcherFromEnvironment({})).toBeUndefined();
  });

  it("publishes an idempotent initial wake-up", async () => {
    send.mockResolvedValue({ messageId: "message-1" });
    await new VercelQueueRunDispatcher().dispatch("RUN-1");
    expect(send).toHaveBeenCalledWith(
      "software-oath-runs",
      { kind: "run.ready", runId: "RUN-1" },
      expect.objectContaining({
        idempotencyKey: "run:RUN-1",
        retentionSeconds: 86_400,
      }),
    );
  });

  it("does not deduplicate a delayed retry", async () => {
    send.mockResolvedValue({ messageId: "message-2" });
    await new VercelQueueRunDispatcher().dispatch("RUN-1", 30);
    expect(send).toHaveBeenCalledWith(
      "software-oath-runs",
      { kind: "run.ready", runId: "RUN-1" },
      expect.objectContaining({ delaySeconds: 30, idempotencyKey: undefined }),
    );
  });
});

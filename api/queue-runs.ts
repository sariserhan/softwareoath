import { handleCallback } from "@vercel/queue";

import { VercelQueueRunDispatcher, type RunEvent } from "../src/control-plane/events";
import { createWorkerRuntime } from "../src/control-plane/worker-runtime";

export const maxDuration = 800;

export const POST = handleCallback<RunEvent>(
  async (event) => {
    if (event.kind !== "run.ready" || !event.runId) {
      throw new Error("Invalid Software Oath run event.");
    }
    const runtime = await createWorkerRuntime();
    try {
      // PostgreSQL remains authoritative. The run ID is a wake-up signal; the
      // existing lease-safe claim path chooses retryable work exactly once.
      const run = await runtime.orchestrator.processNext();
      if (run?.nextAttemptAt) {
        const delaySeconds = Math.max(1, Math.ceil((Date.parse(run.nextAttemptAt) - Date.now()) / 1_000));
        await new VercelQueueRunDispatcher()
          .dispatch(run.id, delaySeconds);
      }
    } finally {
      await runtime.close();
    }
  },
  {
    visibilityTimeoutSeconds: 900,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= 5) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);

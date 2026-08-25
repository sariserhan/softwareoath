import { send } from "@vercel/queue";

export const RUN_TOPIC = "software-oath-runs";

export interface RunEvent {
  kind: "run.ready";
  runId: string;
}

export interface RunDispatcher {
  dispatch(runId: string, delaySeconds?: number): Promise<void>;
}

export class VercelQueueRunDispatcher implements RunDispatcher {
  async dispatch(runId: string, delaySeconds?: number): Promise<void> {
    await send(
      RUN_TOPIC,
      { kind: "run.ready", runId } satisfies RunEvent,
      {
        idempotencyKey: delaySeconds ? undefined : `run:${runId}`,
        retentionSeconds: 24 * 60 * 60,
        delaySeconds,
      },
    );
  }
}

export function runDispatcherFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): RunDispatcher | undefined {
  return env.VERCEL === "1" ? new VercelQueueRunDispatcher() : undefined;
}

import { VercelQueueRunDispatcher } from "../src/control-plane/events";
import { createWorkerRuntime } from "../src/control-plane/worker-runtime";
import { enqueueDueStewardshipRuns } from "../src/steward/schedule";

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const runtime = await createWorkerRuntime();
  try {
    const dispatcher = new VercelQueueRunDispatcher();
    const runs = await enqueueDueStewardshipRuns(runtime.store);
    await Promise.all(runs.map((run) => dispatcher.dispatch(run.id)));
    const ciUpdated = await runtime.orchestrator.monitorCi();
    return Response.json({ scheduled: runs.length, ciUpdated });
  } finally {
    await runtime.close();
  }
}

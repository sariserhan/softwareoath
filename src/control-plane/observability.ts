import type { ControlPlaneStore, HostedRunRecord } from "./types.js";

const terminalStatuses = new Set<HostedRunRecord["status"]>([
  "completed", "blocked", "cancelled", "ci_failed",
]);

function metric(name: string, value: number, labels?: Record<string, string>): string {
  const suffix = labels
    ? "{" + Object.entries(labels)
        .map(([key, label]) => key + "=" + JSON.stringify(label))
        .join(",") + "}"
    : "";
  return name + suffix + " " + value;
}

export async function operationalMetrics(
  store: ControlPlaneStore,
  now = new Date(),
): Promise<string> {
  const [runs, repositories, worker] = await Promise.all([
    store.listRuns(),
    store.listRepositories(),
    store.getLatestHeartbeat("worker"),
  ]);
  const statuses = new Map<string, number>();
  for (const run of runs) statuses.set(run.status, (statuses.get(run.status) ?? 0) + 1);
  const lines = [
    "# HELP software_oath_runs Durable runs by current status.",
    "# TYPE software_oath_runs gauge",
    ...[...statuses].sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => metric("software_oath_runs", count, { status })),
    "# HELP software_oath_runs_total Total durable runs.",
    "# TYPE software_oath_runs_total gauge",
    metric("software_oath_runs_total", runs.length),
    "# HELP software_oath_runs_active Runs that have not reached a terminal state.",
    "# TYPE software_oath_runs_active gauge",
    metric("software_oath_runs_active", runs.filter((run) => !terminalStatuses.has(run.status)).length),
    "# HELP software_oath_runs_retry_wait Runs waiting for an automatic retry.",
    "# TYPE software_oath_runs_retry_wait gauge",
    metric("software_oath_runs_retry_wait", statuses.get("retry_wait") ?? 0),
    "# HELP software_oath_repositories Registered repositories.",
    "# TYPE software_oath_repositories gauge",
    metric("software_oath_repositories", repositories.length),
    "# HELP software_oath_worker_heartbeat_age_seconds Age of the latest worker heartbeat.",
    "# TYPE software_oath_worker_heartbeat_age_seconds gauge",
    metric(
      "software_oath_worker_heartbeat_age_seconds",
      worker ? Math.max(0, (now.getTime() - Date.parse(worker.observedAt)) / 1_000) : -1,
    ),
  ];
  return lines.join("\n") + "\n";
}

export function structuredLog(
  event: string,
  fields: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    ...fields,
  });
}

import { createHash, randomUUID } from "node:crypto";

import type {
  ControlPlaneStore,
  HostedRunRecord,
  IncidentRecord,
  RepositoryRegistration,
} from "../control-plane/types.js";

function cronPart(part: string, value: number, minimum: number, maximum: number): boolean {
  return part.split(",").some((term) => {
    const [range, stepText] = term.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step <= 0) return false;
    if (range === "*") return (value - minimum) % step === 0;
    const [startText, endText] = range.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    return (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= minimum &&
      end <= maximum &&
      value >= start &&
      value <= end &&
      (value - start) % step === 0
    );
  });
}

function localParts(date: Date, timezone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      minute: "numeric",
      hour: "numeric",
      day: "numeric",
      month: "numeric",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    minute: Number(values.minute),
    hour: Number(values.hour),
    day: Number(values.day),
    month: Number(values.month),
    weekday: weekdays[values.weekday],
  };
}

export function scheduleCron(
  schedule: RepositoryRegistration["schedule"],
): string | undefined {
  if (schedule.mode === "disabled") return undefined;
  if (schedule.mode === "daily") return "0 5 * * *";
  if (schedule.mode === "weekly") return "0 5 * * 1";
  if (!schedule.cron) throw new Error("Custom schedules require a cron expression.");
  return schedule.cron;
}

export function nextScheduledAt(
  schedule: RepositoryRegistration["schedule"],
  after = new Date(),
): Date | undefined {
  const expression = scheduleCron(schedule);
  if (!expression) return undefined;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron must contain five fields.");
  let candidate = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let index = 0; index < 366 * 24 * 60; index += 1) {
    const local = localParts(candidate, schedule.timezone);
    if (
      cronPart(parts[0], local.minute, 0, 59) &&
      cronPart(parts[1], local.hour, 0, 23) &&
      cronPart(parts[2], local.day, 1, 31) &&
      cronPart(parts[3], local.month, 1, 12) &&
      cronPart(parts[4], local.weekday, 0, 6)
    ) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error("Cron expression has no occurrence within one year.");
}

export function stewardshipRecords(
  registration: RepositoryRegistration,
  trigger: "schedule" | "manual",
  now = new Date(),
): { incident: IncidentRecord; run: HostedRunRecord } {
  const timestamp = now.toISOString();
  const externalId =
    trigger === "manual"
      ? `${registration.id}:manual:${randomUUID()}`
      : `${registration.id}:schedule:${timestamp.slice(0, 16)}`;
  const incidentId = `SCAN-${randomUUID()}`;
  return {
    incident: {
      id: incidentId,
      source: "stewardship",
      externalId,
      title: `${trigger === "manual" ? "Owner-triggered" : "Scheduled"} repository stewardship`,
      status: "requested",
      project: registration.id,
      receivedAt: timestamp,
      payloadDigest: createHash("sha256").update(externalId).digest("hex"),
    },
    run: {
      id: `RUN-${randomUUID()}`,
      incidentId,
      repository: registration.repository,
      status: "received",
      attempts: 0,
      maxAttempts: 3,
      cancelRequested: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

export async function enqueueStewardshipRun(options: {
  store: ControlPlaneStore;
  registration: RepositoryRegistration;
  trigger: "schedule" | "manual";
  now?: Date;
}): Promise<HostedRunRecord> {
  const now = options.now ?? new Date();
  const records = stewardshipRecords(options.registration, options.trigger, now);
  const stored = await options.store.addIncident(records.incident, records.run);
  const next = nextScheduledAt(options.registration.schedule, now);
  await options.store.upsertRepository({
    ...options.registration,
    lastRunAt: now.toISOString(),
    nextRunAt: next?.toISOString(),
    updatedAt: now.toISOString(),
  });
  return stored.run;
}

export async function enqueueDueStewardshipRuns(
  store: ControlPlaneStore,
  now = new Date(),
): Promise<HostedRunRecord[]> {
  const due = (await store.listRepositories()).filter(
    (repository) =>
      repository.schedule.mode !== "disabled" &&
      (!repository.nextRunAt || repository.nextRunAt <= now.toISOString()),
  );
  return await Promise.all(
    due.map((registration) =>
      enqueueStewardshipRun({ store, registration, trigger: "schedule", now }),
    ),
  );
}

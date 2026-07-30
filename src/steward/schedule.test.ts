import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileControlPlaneStore } from "../control-plane/store";
import type { RepositoryRegistration } from "../control-plane/types";
import {
  enqueueDueStewardshipRuns,
  enqueueStewardshipRun,
  nextScheduledAt,
} from "./schedule";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function registration(): RepositoryRegistration {
  return {
    id: "REPOSITORY-1",
    repository: "owner/repo",
    cloneUrl: "https://github.test/owner/repo.git",
    defaultBranch: "main",
    schedule: { mode: "weekly", timezone: "America/New_York" },
    policy: {
      maxPullRequestsPerRun: 1,
      maxCiRepairAttempts: 2,
      allowMajorPackageUpdates: false,
      automaticMerge: false,
    },
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
  };
}

describe("owner-controlled stewardship schedules", () => {
  it("calculates daily, weekly, and custom schedules in the owner's timezone", () => {
    expect(
      nextScheduledAt(
        { mode: "daily", timezone: "America/New_York" },
        new Date("2026-07-30T08:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-07-30T09:00:00.000Z");
    expect(
      nextScheduledAt(
        { mode: "weekly", timezone: "America/New_York" },
        new Date("2026-07-30T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-08-03T09:00:00.000Z");
    expect(
      nextScheduledAt(
        { mode: "custom", cron: "30 6 * * 2", timezone: "UTC" },
        new Date("2026-07-30T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-08-04T06:30:00.000Z");
  });

  it("supports owner-triggered and due scheduled runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "software-oath-schedule-"));
    roots.push(root);
    const store = new FileControlPlaneStore(join(root, "store.json"));
    const repo = registration();
    await store.upsertRepository({ ...repo, nextRunAt: "2026-07-30T11:00:00Z" });

    const manual = await enqueueStewardshipRun({
      store,
      registration: repo,
      trigger: "manual",
      now: new Date("2026-07-30T12:00:00Z"),
    });
    expect(manual.repository).toBe("owner/repo");
    const dueRepo = {
      ...(await store.getRepository("owner/repo"))!,
      nextRunAt: "2026-07-30T12:01:00Z",
    };
    await store.upsertRepository(dueRepo);
    const scheduled = await enqueueDueStewardshipRuns(
      store,
      new Date("2026-07-30T12:02:00Z"),
    );
    expect(scheduled).toHaveLength(1);
    expect(await store.listRuns()).toHaveLength(2);
  });
});

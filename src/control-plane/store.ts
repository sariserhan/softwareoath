import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  ApprovalRecord,
  ControlPlaneData,
  HostedRunRecord,
  IncidentRecord,
} from "./types";

const emptyData = (): ControlPlaneData => ({
  version: 1,
  incidents: [],
  runs: [],
  approvals: [],
});

export class FileControlPlaneStore {
  private writeChain = Promise.resolve();

  constructor(readonly path: string) {
    this.path = resolve(path);
  }

  async read(): Promise<ControlPlaneData> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as ControlPlaneData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
      throw error;
    }
  }

  private async update(
    mutate: (data: ControlPlaneData) => void,
  ): Promise<ControlPlaneData> {
    let result = emptyData();
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.read();
      mutate(data);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      result = data;
    });
    await this.writeChain;
    return result;
  }

  async addIncident(
    incident: IncidentRecord,
    run: HostedRunRecord,
  ): Promise<{ incident: IncidentRecord; run: HostedRunRecord; duplicate: boolean }> {
    let duplicate = false;
    let storedIncident = incident;
    let storedRun = run;
    await this.update((data) => {
      const existing = data.incidents.find(
        ({ source, externalId }) =>
          source === incident.source && externalId === incident.externalId,
      );
      if (existing) {
        duplicate = true;
        storedIncident = existing;
        storedRun =
          data.runs.find(({ incidentId }) => incidentId === existing.id) ?? run;
        return;
      }
      data.incidents.push(incident);
      data.runs.push(run);
    });
    return { incident: storedIncident, run: storedRun, duplicate };
  }

  async listRuns(): Promise<HostedRunRecord[]> {
    return (await this.read()).runs.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async decide(approval: ApprovalRecord): Promise<HostedRunRecord> {
    let updated: HostedRunRecord | undefined;
    await this.update((data) => {
      const run = data.runs.find(({ id }) => id === approval.runId);
      if (!run) throw new Error(`Run ${approval.runId} was not found.`);
      if (run.status !== "awaiting_approval") {
        throw new Error(`Run ${approval.runId} is not awaiting approval.`);
      }
      data.approvals.push(approval);
      run.status = approval.decision === "approved" ? "completed" : "blocked";
      run.updatedAt = approval.createdAt;
      updated = run;
    });
    return updated!;
  }
}

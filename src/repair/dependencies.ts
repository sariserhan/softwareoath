import type { RepositoryFinding } from "../detector/types";
import { createAdapterRegistry } from "../adapters/registry";
import type { AdapterUpdateExecutor } from "../adapters/npm";
import type { RepairAgent } from "./types";

export class ConservativeDependencyRepairAgent implements RepairAgent {
  readonly name = "software-oath-dependency-updater";

  constructor(
    private readonly fallback: RepairAgent,
    private readonly executor?: AdapterUpdateExecutor,
  ) {}

  async repair(input: {
    workspacePath: string;
    prompt: string;
    finding?: RepositoryFinding;
  }): Promise<{ summary: string; output: string }> {
    const dependency = input.finding?.dependency;
    if (!dependency) {
      return await this.fallback.repair(input);
    }
    const adapter = createAdapterRegistry({
      updateExecutor: this.executor,
    }).find(({ ecosystem }) => ecosystem === dependency.ecosystem);
    if (!adapter?.repair) {
      return await this.fallback.repair(input);
    }
    return await adapter.repair(
      {
        workspacePath: input.workspacePath,
        finding: input.finding!,
      },
    );
  }
}

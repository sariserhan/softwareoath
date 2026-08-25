import type {
  InfracostScanner,
  InfracostScanResult,
} from "./infracost.js";
import type { TrustedRunner } from "../runner/types.js";

export class RunnerInfracostScanner implements InfracostScanner {
  constructor(private readonly runner: TrustedRunner) {}

  async scan(
    workspacePath: string,
    currency: string,
  ): Promise<InfracostScanResult> {
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid cost currency.");
    const [identity, result] = await Promise.all([
      this.runner.identity?.() ?? Promise.resolve(this.runner.name),
      this.runner.execute({
        command:
          `INFRACOST_CURRENCY=${currency} infracost breakdown ` +
          "--path . --format json --show-skipped --no-cache " +
          "--out-file /tmp/infracost.json >/dev/null && cat /tmp/infracost.json",
        workspacePath,
        timeoutMs: 4 * 60_000,
      }),
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Infracost exited with code ${result.exitCode ?? "unknown"}: ${result.output.slice(0, 2_000)}`,
      );
    }
    return {
      output: result.output,
      durationMs: result.durationMs,
      runner: identity,
    };
  }
}

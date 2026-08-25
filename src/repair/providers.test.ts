import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { StructuredRepairAgent, repairAgentFromEnvironment } from "./providers.js";

const finding = {
  id: "F", detector: "test", category: "maintainability", severity: "high",
  title: "Fix", summary: "Fix", evidence: { path: "app.ts", detail: "bad" },
  repair: { objective: "fix", allowedPaths: ["app.ts"], automaticCandidate: true },
} as const;

describe("structured repair providers", () => {
  it("applies only authorized structured changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "repair-provider-"));
    await writeFile(join(root, "app.ts"), "bad\n");
    const agent = new StructuredRepairAgent({
      name: "fixture",
      complete: async () => JSON.stringify({
        summary: "fixed", changes: [{ path: "app.ts", content: "good\n" }],
      }),
    });
    await expect(agent.repair({ workspacePath: root, prompt: "fix", finding }))
      .resolves.toMatchObject({ summary: "fixed" });
    expect(await readFile(join(root, "app.ts"), "utf8")).toBe("good\n");
  });

  it("rejects provider attempts outside the finding scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "repair-provider-"));
    await writeFile(join(root, "app.ts"), "bad\n");
    const agent = new StructuredRepairAgent({
      name: "fixture",
      complete: async () => JSON.stringify({
        summary: "unsafe", changes: [{ path: "../escape", content: "bad" }],
      }),
    });
    await expect(agent.repair({ workspacePath: root, prompt: "fix", finding }))
      .rejects.toThrow(/unauthorized/i);
  });

  it("constructs an OpenAI-compatible provider without a CLI", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"summary\":\"ok\",\"changes\":[]}" } }],
    })));
    const agent = repairAgentFromEnvironment({
      SOFTWARE_OATH_REPAIR_PROVIDER: "openai",
      SOFTWARE_OATH_REPAIR_MODEL: "test-model",
      SOFTWARE_OATH_REPAIR_API_KEY: "test-key",
    }, fetcher);
    expect(agent?.name).toBe("openai/test-model");
  });
});

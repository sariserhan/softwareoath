import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: "./vitest.setup.ts",
    clearMocks: true,
    // Integration tests create Git worktrees and launch repair subprocesses.
    // Running files concurrently makes their 15-second safety timeout flaky.
    fileParallelism: false,
    testTimeout: 15_000,
    execArgv: ["--experimental-require-module", "-r", "./scripts/fix-webidl.cjs"],
  },
});

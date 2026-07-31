import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Fix Node 22.4 jsdom / undici webidl compatibility
const globalWebIdl = (globalThis as unknown as { webidl?: { util?: Record<string, unknown> } }).webidl;
if (globalWebIdl && globalWebIdl.util && typeof globalWebIdl.util.markAsUncloneable !== "function") {
  globalWebIdl.util.markAsUncloneable = () => {};
}

afterEach(() => {
  cleanup();
});

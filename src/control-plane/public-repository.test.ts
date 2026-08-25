import { describe, expect, it } from "vitest";
import { parsePublicGitHubRepository } from "./server.js";

describe("public repository URL validation", () => {
  it("normalizes a public GitHub URL to an immutable clone source", () => {
    expect(parsePublicGitHubRepository("https://github.com/openai/openai-node")).toEqual({
      repository: "openai/openai-node",
      cloneUrl: "https://github.com/openai/openai-node.git",
    });
    expect(parsePublicGitHubRepository("https://github.com/openai/openai-node.git")).toEqual({
      repository: "openai/openai-node",
      cloneUrl: "https://github.com/openai/openai-node.git",
    });
  });

  it.each([
    "http://github.com/openai/openai-node",
    "https://gitlab.com/openai/openai-node",
    "https://github.com/openai/openai-node/issues",
    "https://user:secret@github.com/openai/openai-node",
    "https://github.com/openai/openai-node?token=secret",
  ])("rejects unsafe or non-repository URL %s", (value) => {
    expect(() => parsePublicGitHubRepository(value)).toThrow();
  });
});

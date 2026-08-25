import { describe, expect, it } from "vitest";
import { parsePorcelainV1Z } from "./git-status.js";

describe("NUL-delimited Git status parsing", () => {
  it("preserves spaces, newlines, unicode, and both rename endpoints", () => {
    expect(parsePorcelainV1Z(
      "R  new name\nβ.ts\0old name\nα.ts\0?? untracked space.txt\0 M binary.dat\0",
    )).toEqual({
      changedPaths: ["binary.dat", "new name\nβ.ts", "old name\nα.ts", "untracked space.txt"].sort(),
      untrackedPaths: ["untracked space.txt"],
    });
  });

  it("rejects malformed and incomplete records", () => {
    expect(() => parsePorcelainV1Z("bad\0")).toThrow(/invalid/);
    expect(() => parsePorcelainV1Z("R  destination\0")).toThrow(/incomplete/);
  });
});

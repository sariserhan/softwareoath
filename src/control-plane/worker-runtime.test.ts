import { describe, expect, it } from "vitest";

import { gitBasicAuthorization } from "./worker-runtime.js";

describe("Git transport authorization", () => {
  it("builds GitHub's x-access-token Basic credential at runtime", () => {
    const header = gitBasicAuthorization("_brokered_");
    expect(header.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(header.slice("Basic ".length), "base64").toString("utf8"))
      .toBe("x-access-token:_brokered_");
  });
});

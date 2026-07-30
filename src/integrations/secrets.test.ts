import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SecretBox } from "./secrets";

describe("encrypted secrets", () => {
  it("round-trips authenticated ciphertext and rejects tampering", () => {
    const box = new SecretBox(randomBytes(32).toString("base64"));
    const encrypted = box.encrypt("private-key");

    expect(box.decrypt(encrypted)).toBe("private-key");
    expect(() => box.decrypt(`${encrypted.slice(0, -1)}x`)).toThrow();
  });
});

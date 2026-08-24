import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SecretBox } from "./secrets";

describe("encrypted secrets", () => {
  it("round-trips authenticated ciphertext and rejects tampering", () => {
    const box = new SecretBox(randomBytes(32).toString("base64"));
    const encrypted = box.encrypt("private-key");

    expect(box.decrypt(encrypted)).toBe("private-key");
    const replacement = encrypted.endsWith("x") ? "y" : "x";
    const tampered = `${encrypted.slice(0, -1)}${replacement}`;
    expect(() => box.decrypt(tampered)).toThrow();
  });
});

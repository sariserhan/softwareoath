import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SecretBox } from "./secrets";

describe("encrypted secrets", () => {
  it("round-trips authenticated ciphertext and rejects tampering", () => {
    const box = new SecretBox(randomBytes(32).toString("base64"));
    const encrypted = box.encrypt("private-key");

    expect(box.decrypt(encrypted)).toBe("private-key");
    const parts = encrypted.split(".");
    const ciphertext = parts[3];
    parts[3] = (ciphertext.startsWith("A") ? "B" : "A") + ciphertext.slice(1);
    const tampered = parts.join(".");
    expect(() => box.decrypt(tampered)).toThrow();
  });
});

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { readFile } from "node:fs/promises";

export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) {
      throw new Error("SOFTWARE_OATH_MASTER_KEY must decode to exactly 32 bytes.");
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) {
      throw new Error("Encrypted secret has an invalid format.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export function resolveSecret(options: {
  plaintext?: string;
  encrypted?: string;
  masterKey?: string;
}): string | undefined {
  if (options.encrypted) {
    if (!options.masterKey) {
      throw new Error("SOFTWARE_OATH_MASTER_KEY is required for encrypted secrets.");
    }
    return new SecretBox(options.masterKey).decrypt(options.encrypted);
  }
  return options.plaintext;
}

export async function loadGitHubAppSecrets(
  path: string | undefined,
  masterKey: string | undefined,
): Promise<
  | {
      appId: string;
      slug: string;
      privateKey: string;
      webhookSecret: string;
    }
  | undefined
> {
  if (!path) return undefined;
  if (!masterKey) {
    throw new Error("SOFTWARE_OATH_MASTER_KEY is required for GitHub App config.");
  }
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    appId: string;
    slug: string;
    privateKey: string;
    webhookSecret: string;
  };
  if (raw.version !== 1) throw new Error("Unsupported GitHub App config version.");
  const box = new SecretBox(masterKey);
  return {
    appId: raw.appId,
    slug: raw.slug,
    privateKey: box.decrypt(raw.privateKey),
    webhookSecret: box.decrypt(raw.webhookSecret),
  };
}

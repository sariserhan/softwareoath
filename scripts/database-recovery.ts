import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with code ${code ?? "unknown"}.`)));
  });
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const [command, path] = process.argv.slice(2);
if (!["backup", "restore"].includes(command ?? "") || !path) {
  console.error("Usage: npm run db:recovery -- <backup|restore> <backup.dump>");
  process.exit(2);
}

if (command === "backup") {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for backup.");
  const temporary = path + ".tmp";
  await run("pg_dump", [
    "--format=custom", "--no-owner", "--no-acl", "--file", temporary, databaseUrl,
  ]);
  await rename(temporary, path);
  const manifest = {
    version: 1,
    format: "postgres-custom",
    createdAt: new Date().toISOString(),
    sha256: await digest(path),
  };
  await writeFile(path + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ status: "backup_created", path, ...manifest }) + "\n");
} else {
  const restoreUrl = process.env.RESTORE_DATABASE_URL;
  if (!restoreUrl) throw new Error("RESTORE_DATABASE_URL is required for restore.");
  if (restoreUrl === process.env.DATABASE_URL) {
    throw new Error("Refusing to restore over DATABASE_URL; use an isolated restore database.");
  }
  const manifest = JSON.parse(await readFile(path + ".manifest.json", "utf8")) as {
    version?: unknown; sha256?: unknown;
  };
  const actual = await digest(path);
  if (manifest.version !== 1 || manifest.sha256 !== actual) {
    throw new Error("Backup manifest or SHA-256 verification failed.");
  }
  await run("pg_restore", [
    "--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error",
    "--dbname", restoreUrl, path,
  ]);
  process.stdout.write(JSON.stringify({
    status: "restore_completed", path, sha256: actual, restoredAt: new Date().toISOString(),
  }) + "\n");
}

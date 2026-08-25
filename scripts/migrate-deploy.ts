import process from "node:process";

import { PostgresControlPlaneStore, runMigrations } from "../src/control-plane/postgres.js";

if (process.env.VERCEL_ENV !== "production") {
  process.stdout.write("Skipping database migration outside a Vercel production build.\n");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}

const store = PostgresControlPlaneStore.fromConnectionString(databaseUrl);
try {
  const applied = await runMigrations(store.pool);
  process.stdout.write(
    applied.length ? `Applied: ${applied.join(", ")}\n` : "Database is current.\n",
  );
} finally {
  await store.pool.end();
}

#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createPostgresDb } from "../db/postgres.js";
import { startBoardServer } from "./server.js";
import { installShutdownHandlers } from "./shutdown.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { db, close } = createPostgresDb(databaseUrl);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
    const port = Number(process.env.PORT ?? 8787);
    const server = await startBoardServer({ db, port });
    console.error(`comitia board listening on ${server.baseUrl}`);

    installShutdownHandlers(async () => {
      try {
        await server.close();
      } finally {
        await close();
      }
    });
  } catch (error) {
    await close();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error("comitia board error:", error);
  process.exit(1);
});

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";
import type { Db } from "./types.js";

export type { Db, DbClient } from "./types.js";

export async function createTestDb(): Promise<{
  client: PGlite;
  db: Db;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  return { client, db };
}

export { schema };

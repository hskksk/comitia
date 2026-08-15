import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export function createPostgresDb(databaseUrl: string) {
  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema });
  return {
    db,
    close: () => client.end(),
  };
}

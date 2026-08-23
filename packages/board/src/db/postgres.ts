import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { postgresSslOption } from "./postgres-ssl.js";

export function createPostgresDb(databaseUrl: string) {
  const ssl = postgresSslOption(databaseUrl);
  const client = postgres(databaseUrl, ssl ? { ssl } : {});
  const db = drizzle(client, { schema });
  return {
    db,
    close: () => client.end(),
  };
}

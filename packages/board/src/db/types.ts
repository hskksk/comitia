import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";

export type DbClient =
  | PgliteDatabase<typeof schema>
  | PostgresJsDatabase<typeof schema>;
type DbTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type Db = DbClient | DbTx;

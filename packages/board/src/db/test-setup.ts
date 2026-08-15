import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";

/** トップレベルの DB クライアント（トランザクションを開始できる） */
export type DbClient = PgliteDatabase<typeof schema>;

/** トランザクションハンドル型（DbClient["transaction"] のコールバック引数） */
type DbTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * ドメイン関数が受け取る DB 型。クライアントでもトランザクションでもよい。
 * 状態遷移を伴う操作（declare 等）は DbClient を要求し、内部でトランザクションを張る。
 */
export type Db = DbClient | DbTx;

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

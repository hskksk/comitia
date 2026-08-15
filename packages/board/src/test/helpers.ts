import { beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type Db } from "../db/test-setup.js";

let client: PGlite;
export let db: Db;

beforeEach(async () => {
  const setup = await createTestDb();
  client = setup.client;
  db = setup.db;
});

afterEach(async () => {
  await client.close();
});

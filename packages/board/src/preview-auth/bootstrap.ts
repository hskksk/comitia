import { eq } from "drizzle-orm";
import { participants } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { bootstrapBoard } from "../domain/bootstrap.js";
import type { readPreviewAuthConfig } from "./config.js";

export async function ensurePreviewBootstrap(
  db: Db,
  config: ReturnType<typeof readPreviewAuthConfig>,
) {
  if (!config.enabled || !config.bootstrapToken) {
    return;
  }

  const [existingHuman] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.kind, "human"))
    .limit(1);
  if (existingHuman) {
    return;
  }

  await bootstrapBoard(db, {
    ownerDisplayName: config.ownerDisplayName,
    projectName: config.projectName,
    ownerToken: config.bootstrapToken,
  });
}

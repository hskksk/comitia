import { and, asc, eq, isNull } from "drizzle-orm";
import { memories } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { NotFoundError, PermissionDenied } from "./errors.js";

export async function writeMemory(
  db: Db,
  input: { participantId: string; body: string; supersedeId?: string },
) {
  if (input.supersedeId) {
    const [existing] = await db
      .select()
      .from(memories)
      .where(eq(memories.id, input.supersedeId));
    if (!existing) {
      throw new NotFoundError("記憶が見つかりません");
    }
    if (existing.participantId !== input.participantId) {
      throw new PermissionDenied("他者の記憶は更新できません");
    }
    if (existing.supersededAt === null) {
      await db
        .update(memories)
        .set({ supersededAt: new Date() })
        .where(eq(memories.id, input.supersedeId));
    }
  }

  const [row] = await db
    .insert(memories)
    .values({
      participantId: input.participantId,
      body: input.body,
    })
    .returning();
  return row!;
}

export async function listActiveMemory(db: Db, participantId: string) {
  return db
    .select()
    .from(memories)
    .where(
      and(eq(memories.participantId, participantId), isNull(memories.supersededAt)),
    )
    .orderBy(asc(memories.createdAt));
}

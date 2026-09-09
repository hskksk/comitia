import {
  RETRO_DUE_ENDED_SESSION_COUNT,
  type MemoryLayer,
} from "@comitia/shared";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { memories, participants, sessions } from "../db/schema.js";
import type { Db, DbClient } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import { getParticipant } from "./helpers.js";

function runInTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (typeof (db as DbClient).transaction === "function") {
    return (db as DbClient).transaction((tx) => fn(tx));
  }
  return fn(db);
}

export async function writeMemory(
  db: Db,
  input: {
    participantId: string;
    body: string;
    supersedeId?: string;
    layer?: MemoryLayer;
  },
) {
  const layer: MemoryLayer = input.layer ?? "episodic";

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
    if (existing.layer !== layer) {
      throw new GateViolation("層をまたいだ置き換えはできません");
    }
  }

  return runInTransaction(db, async (tx) => {
    if (input.supersedeId) {
      await tx
        .update(memories)
        .set({ supersededAt: new Date() })
        .where(
          and(eq(memories.id, input.supersedeId), isNull(memories.supersededAt)),
        );
    }

    const [row] = await tx
      .insert(memories)
      .values({
        participantId: input.participantId,
        body: input.body,
        layer,
      })
      .returning();

    if (layer === "norm") {
      await tx
        .update(participants)
        .set({ normReviewedAt: new Date() })
        .where(eq(participants.id, input.participantId));
    }

    await recordEvent(tx, {
      actorParticipantId: input.participantId,
      kind: "memory_written",
      payload: { memoryId: row!.id, layer },
    });

    return row!;
  });
}

export async function listActiveMemory(
  db: Db,
  participantId: string,
  options?: { layer?: MemoryLayer },
) {
  const filters = [
    eq(memories.participantId, participantId),
    isNull(memories.supersededAt),
  ];
  if (options?.layer) {
    filters.push(eq(memories.layer, options.layer));
  }
  return db
    .select()
    .from(memories)
    .where(and(...filters))
    .orderBy(asc(memories.createdAt));
}

export async function isRetroDueForParticipant(
  db: Db,
  participantId: string,
): Promise<boolean> {
  const participant = await getParticipant(db, participantId);
  const since = participant.normReviewedAt ?? participant.createdAt;
  const ended = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, participantId),
        isNotNull(sessions.endedAt),
        gt(sessions.endedAt, since),
      ),
    );
  return ended.length >= RETRO_DUE_ENDED_SESSION_COUNT;
}

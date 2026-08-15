import { and, asc, eq, max } from "drizzle-orm";
import type { Tick } from "@comitia/shared";
import { agentCredentials, ticks } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { recordEvent } from "./events.js";

export async function nextTickSequence(
  db: Db,
  participantId: string,
): Promise<number> {
  const [row] = await db
    .select({ maxSeq: max(ticks.sequence) })
    .from(ticks)
    .where(eq(ticks.participantId, participantId));
  return (row?.maxSeq ?? 0) + 1;
}

export async function insertTick(
  db: Db,
  input: {
    tick: Tick;
    participantId: string;
    status: "queued" | "delivered";
  },
) {
  const sequence = await nextTickSequence(db, input.participantId);
  const [row] = await db
    .insert(ticks)
    .values({
      id: input.tick.id,
      participantId: input.participantId,
      sessionId: input.tick.sessionId ?? null,
      type: input.tick.type,
      issuedAt: new Date(input.tick.issuedAt),
      status: input.status,
      sequence,
      deliveredAt: input.status === "delivered" ? new Date() : null,
    })
    .returning();

  const [cred] = await db
    .select()
    .from(agentCredentials)
    .where(eq(agentCredentials.participantId, input.participantId))
    .limit(1);

  await recordEvent(db, {
    projectId: cred?.projectId,
    actorParticipantId: input.participantId,
    kind: input.status === "delivered" ? "tick_delivered" : "tick_queued",
    payload: {
      tickId: input.tick.id,
      type: input.tick.type,
      sequence,
    },
  });

  return row!;
}

export async function markTickDelivered(db: Db, tickId: string) {
  const [row] = await db
    .update(ticks)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(ticks.id, tickId))
    .returning();
  if (!row) {
    return null;
  }

  const [cred] = await db
    .select()
    .from(agentCredentials)
    .where(eq(agentCredentials.participantId, row.participantId))
    .limit(1);

  await recordEvent(db, {
    projectId: cred?.projectId,
    actorParticipantId: row.participantId,
    kind: "tick_delivered",
    payload: {
      tickId: row.id,
      type: row.type,
      sequence: row.sequence,
    },
  });

  return row;
}

export async function listQueuedTicks(db: Db, participantId: string) {
  return db
    .select()
    .from(ticks)
    .where(
      and(eq(ticks.participantId, participantId), eq(ticks.status, "queued")),
    )
    .orderBy(asc(ticks.sequence));
}

export function tickFromRow(row: {
  id: string;
  type: string;
  issuedAt: Date;
  sessionId: string | null;
}): Tick {
  return {
    id: row.id,
    type: row.type as Tick["type"],
    issuedAt: row.issuedAt.toISOString(),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
  };
}

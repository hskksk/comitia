import { and, eq, isNull, lt, or } from "drizzle-orm";
import { computeRemaining } from "../domain/activity.js";
import { getSessionById } from "../domain/sessions.js";
import { agentConnections, ticks } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { SendTickInput, SendTickResult } from "./send-tick.js";

export async function touchConnection(
  db: Db,
  participantId: string,
  at: Date,
): Promise<void> {
  await db
    .update(agentConnections)
    .set({ lastSeenAt: at })
    .where(eq(agentConnections.participantId, participantId));
}

export async function expireStaleConnections(
  db: Db,
  input: { now: Date; ttlMs: number },
): Promise<string[]> {
  const cutoff = new Date(input.now.getTime() - input.ttlMs);
  const expired = await db
    .update(agentConnections)
    .set({ status: "disconnected" })
    .where(
      and(
        eq(agentConnections.status, "connected"),
        or(
          isNull(agentConnections.lastSeenAt),
          lt(agentConnections.lastSeenAt, cutoff),
        ),
      ),
    )
    .returning();
  return expired.map((row) => row.participantId);
}

export async function maybeSendEndWarning(
  db: Db,
  send: (input: SendTickInput) => Promise<SendTickResult>,
  input: { participantId: string; sessionId: string },
): Promise<void> {
  const session = await getSessionById(db, input.sessionId);
  if (computeRemaining(session) > session.windDownReserved) {
    return;
  }

  const [connection] = await db
    .select()
    .from(agentConnections)
    .where(eq(agentConnections.participantId, input.participantId))
    .limit(1);
  if (connection?.status !== "connected") {
    return;
  }

  const [existing] = await db
    .select({ id: ticks.id })
    .from(ticks)
    .where(
      and(
        eq(ticks.sessionId, input.sessionId),
        eq(ticks.type, "session.end_warning"),
      ),
    )
    .limit(1);
  if (existing) {
    return;
  }

  await send({
    participantId: input.participantId,
    type: "session.end_warning",
  });
}

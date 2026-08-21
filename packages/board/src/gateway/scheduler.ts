import { and, eq, gte } from "drizzle-orm";
import { agentConnections, agentCredentials, sessions } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { findOpenSession } from "../domain/sessions.js";
import type { SendTickInput, SendTickResult } from "./send-tick.js";

export function utcMinutes(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export async function runScheduler(
  db: Db,
  send: (input: SendTickInput) => Promise<SendTickResult>,
  input: { now: Date },
): Promise<void> {
  const minute = utcMinutes(input.now);
  const midnight = utcMidnight(input.now);
  const agents = await db
    .select({
      participantId: agentConnections.participantId,
      sessionStartMinute: agentConnections.sessionStartMinute,
    })
    .from(agentConnections)
    .innerJoin(
      agentCredentials,
      eq(agentCredentials.participantId, agentConnections.participantId),
    );

  for (const agent of agents) {
    if (minute < agent.sessionStartMinute) {
      continue;
    }

    const open = await findOpenSession(db, {
      participantId: agent.participantId,
    });
    if (open) {
      continue;
    }

    const [alreadyToday] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.participantId, agent.participantId),
          gte(sessions.startedAt, midnight),
        ),
      )
      .limit(1);
    if (alreadyToday) {
      continue;
    }

    await send({
      participantId: agent.participantId,
      type: "session.start",
    });
  }
}

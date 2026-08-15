import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import {
  DEFAULT_SESSION_BUDGET,
  WIND_DOWN_RESERVE,
} from "@comitia/shared";
import {
  handovers,
  sessionGoals,
  sessions,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError } from "./errors.js";
import { getProject } from "./helpers.js";

export async function findOpenSession(
  db: Db,
  input: { participantId: string; projectId: string },
) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
        eq(sessions.projectId, input.projectId),
        isNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  return session ?? null;
}

export async function openOrGetSession(
  db: Db,
  input: { participantId: string; projectId: string },
) {
  await getProject(db, input.projectId);

  const existing = await findOpenSession(db, input);
  if (existing) {
    return existing;
  }

  const [session] = await db
    .insert(sessions)
    .values({
      participantId: input.participantId,
      projectId: input.projectId,
      budgetLimit: DEFAULT_SESSION_BUDGET,
      budgetUsed: 0,
      windDownReserved: WIND_DOWN_RESERVE,
    })
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.participantId,
    kind: "session_started",
    payload: {
      sessionId: session!.id,
      budgetLimit: DEFAULT_SESSION_BUDGET,
      windDownReserved: WIND_DOWN_RESERVE,
    },
  });

  return session!;
}

export async function prepareSessionStart(
  db: Db,
  input: { participantId: string; projectId: string },
) {
  await getProject(db, input.projectId);

  const existing = await findOpenSession(db, input);
  if (existing) {
    return existing;
  }

  const [session] = await db
    .insert(sessions)
    .values({
      participantId: input.participantId,
      projectId: input.projectId,
      briefingAt: null,
      budgetLimit: DEFAULT_SESSION_BUDGET,
      budgetUsed: 0,
      windDownReserved: WIND_DOWN_RESERVE,
    })
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.participantId,
    kind: "session_started",
    payload: {
      sessionId: session!.id,
      budgetLimit: DEFAULT_SESSION_BUDGET,
      windDownReserved: WIND_DOWN_RESERVE,
    },
  });

  return session!;
}

export async function findUndigestedSession(
  db: Db,
  input: { participantId: string; projectId: string },
) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
        eq(sessions.projectId, input.projectId),
        isNull(sessions.endedAt),
        isNull(sessions.briefingAt),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  return session ?? null;
}

export async function markSessionDigested(db: Db, sessionId: string) {
  const session = await getSessionById(db, sessionId);
  if (session.briefingAt) {
    return session;
  }

  const briefingAt = new Date();
  const [updated] = await db
    .update(sessions)
    .set({ briefingAt })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.briefingAt)))
    .returning();

  if (!updated) {
    return getSessionById(db, sessionId);
  }

  await recordEvent(db, {
    projectId: updated.projectId,
    actorParticipantId: updated.participantId,
    kind: "session_digested",
    payload: {
      sessionId,
      briefingAt: briefingAt.toISOString(),
    },
  });

  return updated;
}

export async function interruptStaleSessions(
  db: Db,
  input: { now: Date; timeoutMs: number },
): Promise<number> {
  const cutoff = new Date(input.now.getTime() - input.timeoutMs);
  const stale = await db
    .select()
    .from(sessions)
    .where(
      and(
        isNull(sessions.endedAt),
        isNotNull(sessions.briefingAt),
        lt(sessions.startedAt, cutoff),
      ),
    );

  let interrupted = 0;
  for (const session of stale) {
    const [updated] = await db
      .update(sessions)
      .set({ endedAt: input.now, endedReason: "interrupted" })
      .where(
        and(
          eq(sessions.id, session.id),
          isNull(sessions.endedAt),
          isNotNull(sessions.briefingAt),
          lt(sessions.startedAt, cutoff),
        ),
      )
      .returning();
    if (!updated) {
      continue;
    }

    await recordEvent(db, {
      projectId: updated.projectId,
      actorParticipantId: updated.participantId,
      kind: "session_interrupted",
      payload: {
        sessionId: updated.id,
        endedAt: input.now.toISOString(),
      },
    });
    interrupted += 1;
  }

  return interrupted;
}

export async function listSessionGoals(db: Db, sessionId: string) {
  return db
    .select()
    .from(sessionGoals)
    .where(eq(sessionGoals.sessionId, sessionId))
    .orderBy(sessionGoals.sortOrder);
}

export async function setGoals(
  db: Db,
  input: { sessionId: string; texts: string[] },
) {
  const session = await getSessionById(db, input.sessionId);
  if (session.endedAt) {
    throw new GateViolation("セッションは終了しています");
  }

  await db
    .delete(sessionGoals)
    .where(
      and(
        eq(sessionGoals.sessionId, input.sessionId),
        eq(sessionGoals.status, "pending"),
      ),
    );

  const trimmed = input.texts.map((text) => text.trim()).filter(Boolean);
  if (trimmed.length > 0) {
    await db.insert(sessionGoals).values(
      trimmed.map((text, index) => ({
        sessionId: input.sessionId,
        text,
        status: "pending" as const,
        sortOrder: index,
      })),
    );
  }

  const goals = await listSessionGoals(db, input.sessionId);

  await recordEvent(db, {
    projectId: session.projectId,
    actorParticipantId: session.participantId,
    kind: "goals_set",
    payload: {
      sessionId: input.sessionId,
      goalCount: goals.filter((g) => g.status === "pending").length,
    },
  });

  return goals;
}

export async function completeGoal(
  db: Db,
  input: { sessionId: string; goalId: string },
) {
  const session = await getSessionById(db, input.sessionId);
  if (session.endedAt) {
    throw new GateViolation("セッションは終了しています");
  }

  const [goal] = await db
    .select()
    .from(sessionGoals)
    .where(
      and(
        eq(sessionGoals.id, input.goalId),
        eq(sessionGoals.sessionId, input.sessionId),
      ),
    );
  if (!goal) {
    throw new NotFoundError("目標が見つかりません");
  }
  if (goal.status === "completed") {
    return goal;
  }

  const [updated] = await db
    .update(sessionGoals)
    .set({ status: "completed" })
    .where(eq(sessionGoals.id, input.goalId))
    .returning();

  return updated!;
}

export async function endSession(
  db: Db,
  input: { sessionId: string; handover: string },
) {
  const session = await getSessionById(db, input.sessionId);
  if (session.endedAt) {
    throw new GateViolation("セッションは既に終了しています");
  }
  if (!input.handover.trim()) {
    throw new GateViolation("申し送り（handover）は必須です");
  }

  const endedAt = new Date();
  const [updated] = await db
    .update(sessions)
    .set({ endedAt, endedReason: "completed" })
    .where(eq(sessions.id, input.sessionId))
    .returning();

  await db.insert(handovers).values({
    sessionId: input.sessionId,
    body: input.handover.trim(),
  });

  await recordEvent(db, {
    projectId: session.projectId,
    actorParticipantId: session.participantId,
    kind: "session_ended",
    payload: {
      sessionId: input.sessionId,
      endedAt: endedAt.toISOString(),
    },
  });

  return updated!;
}

export async function getSessionById(db: Db, sessionId: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session) {
    throw new NotFoundError("セッションが見つかりません");
  }
  return session;
}

export async function getLatestPreviousHandover(
  db: Db,
  input: { participantId: string; projectId: string; beforeSessionId?: string },
): Promise<string> {
  const endedSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
        eq(sessions.projectId, input.projectId),
        isNotNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.endedAt));

  for (const session of endedSessions) {
    if (input.beforeSessionId && session.id === input.beforeSessionId) {
      continue;
    }
    const [handover] = await db
      .select()
      .from(handovers)
      .where(eq(handovers.sessionId, session.id))
      .orderBy(desc(handovers.id))
      .limit(1);
    if (handover) {
      return handover.body;
    }
  }

  return "";
}

export async function wasLatestPreviousSessionInterrupted(
  db: Db,
  input: { participantId: string; projectId: string; beforeSessionId?: string },
): Promise<boolean> {
  const endedSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
        eq(sessions.projectId, input.projectId),
        isNotNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.endedAt));

  const latest = endedSessions.find(
    (session) => session.id !== input.beforeSessionId,
  );
  return latest?.endedReason === "interrupted";
}

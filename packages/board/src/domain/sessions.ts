import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  DEFAULT_SESSION_BUDGET,
  WIND_DOWN_RESERVE,
} from "@comitia/shared";
import {
  agentConnections,
  events,
  handovers,
  sessionGoals,
  sessionProjectEngagements,
  sessions,
  type HandoverProjectNote,
} from "../db/schema.js";
import type { Db, DbClient } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError } from "./errors.js";
import { getProject } from "./helpers.js";
import { listMembershipsForParticipant } from "./memberships.js";

function runInTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (typeof (db as DbClient).transaction === "function") {
    return (db as DbClient).transaction((tx) => fn(tx));
  }
  return fn(db);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 4 && current && typeof current === "object"; i += 1) {
    if ("code" in current && (current as { code: unknown }).code === "23505") {
      return true;
    }
    current =
      "cause" in current ? (current as { cause: unknown }).cause : undefined;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key|unique constraint|unique index/i.test(message);
}

async function lockAgentConnectionIfPresent(db: Db, participantId: string) {
  await db
    .select({ participantId: agentConnections.participantId })
    .from(agentConnections)
    .where(eq(agentConnections.participantId, participantId))
    .for("update");
}

async function insertOpenSession(
  db: Db,
  input: { participantId: string; projectId?: string | null },
) {
  const [session] = await db
    .insert(sessions)
    .values({
      participantId: input.participantId,
      projectId: input.projectId ?? null,
      focusProjectId: null,
      briefingAt: null,
      budgetLimit: DEFAULT_SESSION_BUDGET,
      budgetUsed: 0,
      windDownReserved: WIND_DOWN_RESERVE,
    })
    .returning();

  await recordEvent(db, {
    projectId: input.projectId ?? null,
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

async function existingOrInsertOpenSession(
  db: Db,
  input: { participantId: string; projectId?: string | null },
) {
  const existing = await findOpenSession(db, input);
  if (existing) {
    return existing;
  }
  try {
    return await insertOpenSession(db, input);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const again = await findOpenSession(db, input);
    if (again) {
      return again;
    }
    throw error;
  }
}

async function sessionLastActivityAt(
  db: Db,
  session: {
    id: string;
    participantId: string;
    startedAt: Date;
    briefingAt: Date | null;
  },
): Promise<Date> {
  const [latest] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(
      and(
        eq(events.actorParticipantId, session.participantId),
        sql`${events.payload}->>'sessionId' = ${session.id}`,
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(1);

  let latestMs = session.startedAt.getTime();
  if (session.briefingAt) {
    latestMs = Math.max(latestMs, session.briefingAt.getTime());
  }
  if (latest?.createdAt) {
    latestMs = Math.max(latestMs, latest.createdAt.getTime());
  }
  return new Date(latestMs);
}

export async function findOpenSession(
  db: Db,
  input: { participantId: string; projectId?: string | null },
) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
        isNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  return session ?? null;
}

export async function openOrGetSession(
  db: Db,
  input: { participantId: string; projectId?: string | null },
) {
  if (input.projectId) {
    await getProject(db, input.projectId);
  }
  return existingOrInsertOpenSession(db, input);
}

export async function prepareSessionStart(
  db: Db,
  input: { participantId: string; projectId?: string | null },
) {
  if (input.projectId) {
    await getProject(db, input.projectId);
  }

  try {
    return await runInTransaction(db, async (tx) => {
      await lockAgentConnectionIfPresent(tx, input.participantId);
      const existing = await findOpenSession(tx, input);
      if (existing) {
        return existing;
      }
      return insertOpenSession(tx, { participantId: input.participantId });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const existing = await findOpenSession(db, input);
    if (existing) {
      return existing;
    }
    throw error;
  }
}

export async function findUndigestedSession(
  db: Db,
  input: { participantId: string; projectId?: string | null },
) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
        isNull(sessions.endedAt),
        isNull(sessions.briefingAt),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  return session ?? null;
}

export async function recordSessionProjectEngagement(
  db: Db,
  input: { sessionId: string; projectId: string },
) {
  await db
    .insert(sessionProjectEngagements)
    .values({
      sessionId: input.sessionId,
      projectId: input.projectId,
    })
    .onConflictDoNothing();
}

export async function listSessionProjectEngagements(db: Db, sessionId: string) {
  return db
    .select()
    .from(sessionProjectEngagements)
    .where(eq(sessionProjectEngagements.sessionId, sessionId));
}

export async function setSessionFocus(
  db: Db,
  input: { sessionId: string; projectId: string },
) {
  await getProject(db, input.projectId);
  const [updated] = await db
    .update(sessions)
    .set({
      focusProjectId: input.projectId,
      projectId: input.projectId,
    })
    .where(eq(sessions.id, input.sessionId))
    .returning();
  if (!updated) {
    throw new NotFoundError("セッションが見つかりません");
  }
  await recordSessionProjectEngagement(db, {
    sessionId: input.sessionId,
    projectId: input.projectId,
  });
  return updated;
}

export async function markSessionDigested(db: DbClient, sessionId: string) {
  return db.transaction(async (tx) => {
    const session = await getSessionById(tx, sessionId);
    if (session.briefingAt) {
      return session;
    }

    const briefingAt = new Date();
    const [updated] = await tx
      .update(sessions)
      .set({ briefingAt })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.briefingAt)))
      .returning();

    if (!updated) {
      return getSessionById(tx, sessionId);
    }

    await recordEvent(tx, {
      projectId: updated.projectId,
      actorParticipantId: updated.participantId,
      kind: "session_digested",
      payload: {
        sessionId,
        briefingAt: briefingAt.toISOString(),
      },
    });

    return updated;
  });
}

export async function interruptStaleSessions(
  db: DbClient,
  input: { now: Date; timeoutMs: number },
): Promise<number> {
  return db.transaction(async (tx) => {
    const cutoff = new Date(input.now.getTime() - input.timeoutMs);
    const candidates = await tx
      .select()
      .from(sessions)
      .where(and(isNull(sessions.endedAt), isNotNull(sessions.briefingAt)));

    let interrupted = 0;
    for (const session of candidates) {
      const lastActivity = await sessionLastActivityAt(tx, session);
      if (lastActivity >= cutoff) {
        continue;
      }

      const [updated] = await tx
        .update(sessions)
        .set({ endedAt: input.now, endedReason: "interrupted" })
        .where(
          and(
            eq(sessions.id, session.id),
            isNull(sessions.endedAt),
            isNotNull(sessions.briefingAt),
          ),
        )
        .returning();
      if (!updated) {
        continue;
      }

      await recordEvent(tx, {
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
  });
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
  input: {
    sessionId: string;
    handover: string;
    projects?: { projectId: string; summary: string }[];
  },
) {
  const session = await getSessionById(db, input.sessionId);
  if (session.endedAt) {
    throw new GateViolation("セッションは既に終了しています");
  }
  if (!input.handover.trim()) {
    throw new GateViolation("申し送り（handover）は必須です");
  }

  const memberships = await listMembershipsForParticipant(
    db,
    session.participantId,
  );
  const engagements = await listSessionProjectEngagements(db, input.sessionId);
  const notes = await resolveHandoverProjects(db, {
    memberships,
    engagements,
    requested: input.projects,
  });

  const endedAt = new Date();
  const [updated] = await db
    .update(sessions)
    .set({ endedAt, endedReason: "completed" })
    .where(eq(sessions.id, input.sessionId))
    .returning();

  await db.insert(handovers).values({
    sessionId: input.sessionId,
    body: input.handover.trim(),
    projects: notes,
  });

  await recordEvent(db, {
    projectId: session.projectId,
    actorParticipantId: session.participantId,
    kind: "session_ended",
    payload: {
      sessionId: input.sessionId,
      endedAt: endedAt.toISOString(),
      projects: notes,
    },
  });

  return updated!;
}

async function resolveHandoverProjects(
  db: Db,
  input: {
    memberships: { id: string; name: string }[];
    engagements: { projectId: string }[];
    requested?: { projectId: string; summary: string }[];
  },
): Promise<HandoverProjectNote[]> {
  if (input.requested && input.requested.length > 0) {
    const notes: HandoverProjectNote[] = [];
    for (const row of input.requested) {
      const membership = input.memberships.find((item) => item.id === row.projectId);
      if (!membership) {
        throw new GateViolation(
          "申し送りの projects は所属しているプロジェクトだけを書いてください",
        );
      }
      notes.push({
        projectId: membership.id,
        name: membership.name,
        summary: row.summary.trim(),
      });
    }
    return notes;
  }

  if (input.memberships.length >= 2) {
    throw new GateViolation(
      "所属が複数あるので、申し送りの projects にプロジェクトごとの要約を書いてください",
    );
  }

  if (input.memberships.length === 1) {
    return [
      {
        projectId: input.memberships[0]!.id,
        name: input.memberships[0]!.name,
        summary: "",
      },
    ];
  }

  if (input.engagements.length === 1) {
    const project = await getProject(db, input.engagements[0]!.projectId);
    return [
      {
        projectId: project.id,
        name: project.name,
        summary: "",
      },
    ];
  }

  return [];
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
  input: { participantId: string; projectId?: string | null; beforeSessionId?: string },
): Promise<{ body: string; projects: HandoverProjectNote[] }> {
  const endedSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
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
      const stored = handover.projects ?? [];
      if (stored.length > 0) {
        return { body: handover.body, projects: stored };
      }
      if (session.projectId) {
        const project = await getProject(db, session.projectId);
        return {
          body: handover.body,
          projects: [
            { projectId: project.id, name: project.name, summary: "" },
          ],
        };
      }
      return { body: handover.body, projects: [] };
    }
  }

  return { body: "", projects: [] };
}

export async function wasLatestPreviousSessionInterrupted(
  db: Db,
  input: { participantId: string; projectId?: string | null; beforeSessionId?: string },
): Promise<boolean> {
  const endedSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.participantId),
        isNotNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.endedAt));

  const latest = endedSessions.find(
    (session) => session.id !== input.beforeSessionId,
  );
  return latest?.endedReason === "interrupted";
}

/** 指定時刻以降に開始されたセッションを持つ参加者の ID 一覧（終了していても含む）。 */
export async function listParticipantsWithSessionSince(
  db: Db,
  input: { projectId: string; since: Date },
): Promise<string[]> {
  const viaSession = await db
    .selectDistinct({ participantId: sessions.participantId })
    .from(sessions)
    .where(
      and(
        eq(sessions.projectId, input.projectId),
        sql`${sessions.startedAt} >= ${input.since}`,
      ),
    );
  const viaEngagement = await db
    .selectDistinct({ participantId: sessions.participantId })
    .from(sessionProjectEngagements)
    .innerJoin(
      sessions,
      eq(sessionProjectEngagements.sessionId, sessions.id),
    )
    .where(
      and(
        eq(sessionProjectEngagements.projectId, input.projectId),
        sql`${sessions.startedAt} >= ${input.since}`,
      ),
    );
  return [
    ...new Set([
      ...viaSession.map((row) => row.participantId),
      ...viaEngagement.map((row) => row.participantId),
    ]),
  ];
}

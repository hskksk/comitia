import { eq } from "drizzle-orm";
import { getToolCost } from "@comitia/shared";
import { sessions } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError } from "./errors.js";

export function computeRemaining(session: {
  budgetLimit: number;
  budgetUsed: number;
}): number {
  return session.budgetLimit - session.budgetUsed;
}

export function computeUsableRemaining(session: {
  budgetLimit: number;
  budgetUsed: number;
  windDownReserved: number;
}): number {
  return computeRemaining(session) - session.windDownReserved;
}

export async function getSessionRow(db: Db, sessionId: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session) {
    throw new NotFoundError("セッションが見つかりません");
  }
  return session;
}

export async function getRemainingBudget(db: Db, sessionId: string): Promise<number> {
  const session = await getSessionRow(db, sessionId);
  return computeRemaining(session);
}

/** Reserved for M3 token accounting; not used by MCP tools in M2. */
export async function addTokenUsage(
  db: Db,
  sessionId: string,
  tokens: number,
): Promise<number> {
  if (tokens <= 0) {
    return getRemainingBudget(db, sessionId);
  }

  const session = await getSessionRow(db, sessionId);
  if (session.endedAt) {
    throw new GateViolation("セッションは終了しています");
  }

  const [updated] = await db
    .update(sessions)
    .set({ budgetUsed: session.budgetUsed + tokens })
    .where(eq(sessions.id, sessionId))
    .returning();

  return computeRemaining(updated!);
}

export async function spend(
  db: Db,
  sessionId: string,
  toolName: string,
): Promise<number> {
  const session = await getSessionRow(db, sessionId);
  if (session.endedAt) {
    throw new GateViolation("セッションは終了しています");
  }

  const cost = getToolCost(toolName);
  const remaining = computeRemaining(session);

  if (toolName !== "end_session") {
    if (remaining <= session.windDownReserved) {
      throw new GateViolation(
        "予算がウィンドダウン予約分まで減少したため、end_session のみ利用可能です",
      );
    }
    const usable = computeUsableRemaining(session);
    if (cost > usable) {
      throw new GateViolation("予算不足です");
    }
  }

  const charged = toolName === "end_session" ? Math.min(cost, remaining) : cost;
  if (charged === 0) {
    return remaining;
  }

  const [updated] = await db
    .update(sessions)
    .set({ budgetUsed: session.budgetUsed + charged })
    .where(eq(sessions.id, sessionId))
    .returning();

  await recordEvent(db, {
    projectId: session.projectId,
    actorParticipantId: session.participantId,
    kind: "budget_spent",
    payload: {
      sessionId,
      toolName,
      cost: charged,
      budgetUsed: updated!.budgetUsed,
      remaining: computeRemaining(updated!),
    },
  });

  return computeRemaining(updated!);
}

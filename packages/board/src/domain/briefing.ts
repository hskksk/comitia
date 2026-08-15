import { and, eq } from "drizzle-orm";
import { threads } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { computeRemaining } from "./activity.js";
import {
  getLatestPreviousHandover,
  listSessionGoals,
  openOrGetSession,
} from "./sessions.js";

export async function getBriefing(
  db: Db,
  input: { participantId: string; projectId: string },
) {
  const session = await openOrGetSession(db, input);

  const handover = await getLatestPreviousHandover(db, {
    participantId: input.participantId,
    projectId: input.projectId,
    beforeSessionId: session.id,
  });

  const ownedThreads = await db
    .select({
      id: threads.id,
      title: threads.title,
      type: threads.type,
      state: threads.state,
    })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, input.projectId),
        eq(threads.ownerParticipantId, input.participantId),
      ),
    );

  const awaitingDecision = ownedThreads.filter(
    (thread) => thread.state === "awaiting_decision",
  );

  const goals = await listSessionGoals(db, session.id);
  const incompleteGoals = goals
    .filter((goal) => goal.status === "pending")
    .map((goal) => ({
      id: goal.id,
      text: goal.text,
      status: goal.status,
    }));

  return {
    sessionId: session.id,
    handover,
    rules: "",
    situation: {
      threads: ownedThreads,
      ...(awaitingDecision.length > 0
        ? { awaiting_decision: awaitingDecision }
        : {}),
      incomplete_goals: incompleteGoals,
    },
    remaining_budget: computeRemaining(session),
  };
}

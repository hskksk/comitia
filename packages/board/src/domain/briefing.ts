import { and, eq, isNull } from "drizzle-orm";
import { threads } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { computeRemaining } from "./activity.js";
import { searchAgreements } from "./agreements.js";
import { getParticipant, getProject } from "./helpers.js";
import { listProjectParticipants } from "./human-ops.js";
import {
  getLatestPreviousHandover,
  listSessionGoals,
  markSessionDigested,
  openOrGetSession,
  wasLatestPreviousSessionInterrupted,
} from "./sessions.js";
import { searchThreads } from "./threads.js";
import { listActiveMemory } from "./memory.js";
import {
  listActiveProjectClaims,
  listUnclaimedDecidedImplementations,
} from "./work-claims.js";

const OPEN_THREAD_STATES = new Set(["discussing", "awaiting_decision"]);

export async function getBriefing(
  db: Db,
  input: { participantId: string; projectId: string },
) {
  const session = await openOrGetSession(db, input);
  const digestedSession = await markSessionDigested(db, session.id);

  const previousInterrupted = await wasLatestPreviousSessionInterrupted(db, {
    participantId: input.participantId,
    projectId: input.projectId,
    beforeSessionId: digestedSession.id,
  });
  const handover = previousInterrupted
    ? ""
    : await getLatestPreviousHandover(db, {
        participantId: input.participantId,
        projectId: input.projectId,
        beforeSessionId: digestedSession.id,
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
        isNull(threads.archivedAt),
      ),
    );

  const awaitingDecision = ownedThreads.filter(
    (thread) => thread.state === "awaiting_decision",
  );

  const goals = await listSessionGoals(db, digestedSession.id);
  const incompleteGoals = goals
    .filter((goal) => goal.status === "pending")
    .map((goal) => ({
      id: goal.id,
      text: goal.text,
      status: goal.status,
    }));

  const [
    project,
    participant,
    bindingAgreements,
    allThreads,
    participants,
    workClaims,
    unclaimedDecided,
    activeMemory,
  ] = await Promise.all([
    getProject(db, input.projectId),
    getParticipant(db, input.participantId),
    searchAgreements(db, {
      projectId: input.projectId,
      onlyActiveBinding: true,
    }),
    searchThreads(db, { projectId: input.projectId }),
    listProjectParticipants(db, input.projectId),
    listActiveProjectClaims(db, input.projectId),
    listUnclaimedDecidedImplementations(db, input.projectId),
    listActiveMemory(db, input.participantId),
  ]);

  const you = participants.find((row) => row.id === input.participantId);
  const openThreads = allThreads
    .filter((thread) => OPEN_THREAD_STATES.has(thread.state))
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      type: thread.type,
      state: thread.state,
    }));

  return {
    sessionId: digestedSession.id,
    handover,
    memory: activeMemory.map((m) => m.body).join("\n"),
    you: {
      displayName: you?.label ?? participant.displayName,
      roles: you?.roles ?? [],
      engine: participant.engine,
    },
    project: {
      name: project.name,
      repoUrl: project.repoUrl,
      githubOwner: project.githubOwner,
      githubRepo: project.githubRepo,
    },
    rules: bindingAgreements.map((agreement) => agreement.summary).join("\n"),
    situation: {
      threads: ownedThreads,
      open_threads: openThreads,
      work_claims: workClaims,
      unclaimed_decided: unclaimedDecided,
      participants: participants.map((row) => ({
        displayName: row.label,
        roles: row.roles,
        kind: row.kind,
      })),
      gates: {
        conflict_citations_required: bindingAgreements.length > 0,
      },
      ...(awaitingDecision.length > 0
        ? { awaiting_decision: awaitingDecision }
        : {}),
      incomplete_goals: incompleteGoals,
      ...(previousInterrupted ? { previous_interrupted: true } : {}),
    },
    remaining_budget: computeRemaining(digestedSession),
  };
}

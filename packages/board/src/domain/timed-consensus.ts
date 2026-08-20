import { and, eq, inArray } from "drizzle-orm";
import { threads } from "../db/schema.js";
import type { Db, DbClient } from "../db/test-setup.js";
import { evaluateConsensus, type ObjectionInput } from "./consensus.js";
import { declare } from "./declare.js";
import { getMainParticipants, getProposalVersion, getThreadRow } from "./helpers.js";
import { getSystemParticipant } from "./participants.js";
import { getThreadApprovals, getThreadObjections } from "./posts.js";
import { listParticipantsWithSessionSince } from "./sessions.js";

const TIMED_TYPES = ["no_objection", "silence"] as const;

function summaryFromContent(content: string): string {
  return content.length > 200 ? `${content.slice(0, 200)}…` : content;
}

async function objectionsFor(
  db: Db,
  threadId: string,
  candidateVersionId: string,
): Promise<ObjectionInput[]> {
  const rows = await getThreadObjections(db, threadId);
  return rows
    .filter((o) => o.proposalVersionId === candidateVersionId)
    .map((o) => ({
      authorId: o.authorParticipantId,
      blocking: o.blocking ?? false,
      resolvedAt: o.resolvedAt,
      proposalVersionId: o.proposalVersionId!,
    }));
}

async function approvalsFor(db: Db, threadId: string) {
  const rows = await getThreadApprovals(db, threadId);
  return rows
    .filter((a) => a.proposalVersionId !== null)
    .map((a) => ({
      participantId: a.authorParticipantId,
      proposalVersionId: a.proposalVersionId!,
    }));
}

/** ゲートウェイの runLoopTick から呼ぶ。awaiting の no_objection/silence を評価し、成立したら clock_satisfy を積む。 */
export async function evaluateTimedConsensus(
  db: Db,
  input: { now: Date },
): Promise<void> {
  const rows = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.state, "awaiting_decision"),
        inArray(threads.consensusType, [...TIMED_TYPES]),
      ),
    );
  if (rows.length === 0) {
    return;
  }

  const system = await getSystemParticipant(db);

  for (const thread of rows) {
    if (!thread.candidateProposalVersionId || !thread.timingEndsAt) {
      continue;
    }
    const mainParticipants = await getMainParticipants(db, thread.id);
    const objections = await objectionsFor(
      db,
      thread.id,
      thread.candidateProposalVersionId,
    );
    const sessionsAfterAwaiting = thread.awaitingEnteredAt
      ? await listParticipantsWithSessionSince(db, {
          projectId: thread.projectId,
          since: thread.awaitingEnteredAt,
        })
      : [];

    const evaluation = evaluateConsensus({
      consensusType: thread.consensusType!,
      candidateVersionId: thread.candidateProposalVersionId,
      objections,
      mainParticipantIds: mainParticipants.map((p) => p.id),
      mainParticipants,
      now: input.now,
      awaitingEnteredAt: thread.awaitingEnteredAt,
      timingEndsAt: thread.timingEndsAt,
      sessionsAfterAwaiting,
    });

    if (!evaluation.satisfied) {
      continue;
    }

    const { version } = await getProposalVersion(
      db,
      thread.candidateProposalVersionId,
    );

    await declare(db as DbClient, {
      threadId: thread.id,
      actorId: system.id,
      kind: "clock_satisfy",
      payload: { binding: false, summary: summaryFromContent(version.content) },
    });
  }
}

/** approval 投稿の直後に呼ぶ。unanimous なスレッドが揃っていれば同じ clock_satisfy を積む。 */
export async function maybeFinalizeUnanimous(
  db: Db,
  input: { threadId: string },
): Promise<void> {
  const thread = await getThreadRow(db, input.threadId);
  if (thread.state !== "awaiting_decision" || thread.consensusType !== "unanimous") {
    return;
  }
  if (!thread.candidateProposalVersionId) {
    return;
  }

  const mainParticipants = await getMainParticipants(db, thread.id);
  const approvals = await approvalsFor(db, thread.id);

  const evaluation = evaluateConsensus({
    consensusType: "unanimous",
    candidateVersionId: thread.candidateProposalVersionId,
    objections: [],
    mainParticipantIds: mainParticipants.map((p) => p.id),
    mainParticipants,
    approvals,
    engineDiversity: thread.engineDiversity,
  });

  if (!evaluation.satisfied) {
    return;
  }

  const system = await getSystemParticipant(db);
  const { version } = await getProposalVersion(db, thread.candidateProposalVersionId);

  await declare(db as DbClient, {
    threadId: thread.id,
    actorId: system.id,
    kind: "clock_satisfy",
    payload: { binding: false, summary: summaryFromContent(version.content) },
  });
}

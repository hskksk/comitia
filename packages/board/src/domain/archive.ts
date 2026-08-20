import { and, eq, isNull } from "drizzle-orm";
import { agreements, proposals, proposalVersions, threads } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import { getProject, getThreadRow } from "./helpers.js";

export async function archiveThread(
  db: Db,
  input: { threadId: string; actorId: string },
) {
  const thread = await getThreadRow(db, input.threadId);
  if (thread.archivedAt) {
    throw new NotFoundError("スレッドが見つかりません");
  }
  const project = await getProject(db, thread.projectId);
  if (project.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("プロジェクトオーナーのみ実行できます");
  }
  const [binding] = await db
    .select({ id: agreements.id })
    .from(agreements)
    .where(
      and(
        eq(agreements.threadId, thread.id),
        eq(agreements.state, "active"),
        eq(agreements.binding, true),
      ),
    )
    .limit(1);
  if (binding) {
    throw new GateViolation(
      "拘束的な有効合意があるスレッドは削除できません",
    );
  }
  await db
    .update(threads)
    .set({ archivedAt: new Date() })
    .where(eq(threads.id, thread.id));
  await recordEvent(db, {
    projectId: thread.projectId,
    threadId: thread.id,
    actorParticipantId: input.actorId,
    kind: "thread_archived",
    payload: { threadId: thread.id },
  });
}

export async function archiveProposal(
  db: Db,
  input: { threadId: string; proposalId: string; actorId: string },
) {
  const thread = await getThreadRow(db, input.threadId);
  if (thread.archivedAt) {
    throw new NotFoundError("スレッドが見つかりません");
  }
  const project = await getProject(db, thread.projectId);
  if (project.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("プロジェクトオーナーのみ実行できます");
  }
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(
      and(eq(proposals.id, input.proposalId), eq(proposals.threadId, thread.id)),
    )
    .limit(1);
  if (!proposal || proposal.archivedAt) {
    throw new NotFoundError("提案が見つかりません");
  }
  if (thread.candidateProposalVersionId) {
    const [candidate] = await db
      .select({ id: proposalVersions.id })
      .from(proposalVersions)
      .where(
        and(
          eq(proposalVersions.id, thread.candidateProposalVersionId),
          eq(proposalVersions.proposalId, proposal.id),
        ),
      )
      .limit(1);
    if (candidate) {
      throw new GateViolation("候補になっている提案は先に候補を外してください");
    }
  }
  await db
    .update(proposals)
    .set({ archivedAt: new Date() })
    .where(eq(proposals.id, proposal.id));
  await recordEvent(db, {
    projectId: thread.projectId,
    threadId: thread.id,
    actorParticipantId: input.actorId,
    kind: "proposal_archived",
    payload: { threadId: thread.id, proposalId: proposal.id },
  });
}

export function notArchivedThread() {
  return isNull(threads.archivedAt);
}

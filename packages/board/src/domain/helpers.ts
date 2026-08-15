import { and, eq, ilike, or } from "drizzle-orm";
import {
  agreements,
  participants,
  projects,
  proposals,
  proposalVersions,
  roleAssignments,
  threads,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { NotFoundError, PermissionDenied } from "./errors.js";

export async function getParticipant(db: Db, participantId: string) {
  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, participantId));
  if (!participant) {
    throw new NotFoundError("参加者が見つかりません");
  }
  return participant;
}

export async function getProject(db: Db, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) {
    throw new NotFoundError("プロジェクトが見つかりません");
  }
  return project;
}

export async function getThreadRow(db: Db, threadId: string) {
  const [thread] = await db
    .select()
    .from(threads)
    .where(eq(threads.id, threadId));
  if (!thread) {
    throw new NotFoundError("スレッドが見つかりません");
  }
  return thread;
}

export async function assertProjectOwner(
  db: Db,
  projectId: string,
  actorId: string,
) {
  const project = await getProject(db, projectId);
  if (project.ownerParticipantId !== actorId) {
    throw new PermissionDenied("プロジェクトオーナーのみ実行できます");
  }
  return project;
}

export async function isProjectOwner(
  db: Db,
  projectId: string,
  participantId: string,
) {
  const project = await getProject(db, projectId);
  return project.ownerParticipantId === participantId;
}

export async function isThreadOwner(
  db: Db,
  threadId: string,
  participantId: string,
) {
  const thread = await getThreadRow(db, threadId);
  return thread.ownerParticipantId === participantId;
}

export async function assertThreadOwnerOrProjectOwner(
  db: Db,
  threadId: string,
  actorId: string,
) {
  const thread = await getThreadRow(db, threadId);
  const isOwner = thread.ownerParticipantId === actorId;
  const isProjOwner = await isProjectOwner(db, thread.projectId, actorId);
  if (!isOwner && !isProjOwner) {
    throw new PermissionDenied(
      "スレッドオーナーまたはプロジェクトオーナーのみ実行できます",
    );
  }
  return thread;
}

export async function assertThreadOwner(db: Db, threadId: string, actorId: string) {
  const thread = await getThreadRow(db, threadId);
  if (thread.ownerParticipantId !== actorId) {
    throw new PermissionDenied("スレッドオーナーのみ実行できます");
  }
  return thread;
}

export async function getMainParticipantIds(db: Db, threadId: string) {
  const thread = await getThreadRow(db, threadId);
  const assignments = await db
    .select({ participantId: roleAssignments.participantId })
    .from(roleAssignments)
    .where(eq(roleAssignments.projectId, thread.projectId));

  const ids = new Set(assignments.map((a) => a.participantId));
  ids.add(thread.ownerParticipantId);
  return [...ids];
}

export async function getProposalVersion(
  db: Db,
  proposalVersionId: string,
) {
  const [row] = await db
    .select({
      version: proposalVersions,
      proposal: proposals,
    })
    .from(proposalVersions)
    .innerJoin(proposals, eq(proposalVersions.proposalId, proposals.id))
    .where(eq(proposalVersions.id, proposalVersionId));
  if (!row) {
    throw new NotFoundError("提案版が見つかりません");
  }
  return row;
}

export async function countActiveBindingAgreements(
  db: Db,
  projectId: string,
) {
  const rows = await db
    .select({ id: agreements.id })
    .from(agreements)
    .where(
      and(
        eq(agreements.projectId, projectId),
        eq(agreements.state, "active"),
        eq(agreements.binding, true),
      ),
    );
  return rows.length;
}

export function buildThreadTextFilter(textQuery?: string) {
  if (!textQuery?.trim()) {
    return undefined;
  }
  const q = `%${textQuery.trim()}%`;
  return or(
    ilike(threads.title, q),
    ilike(threads.trigger, q),
    ilike(threads.duplicateSearchQuery, q),
  );
}

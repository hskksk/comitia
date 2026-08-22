import { and, asc, eq, inArray } from "drizzle-orm";
import { participants, threads, workClaims } from "../db/schema.js";
import type { Db, DbClient } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import { getParticipant, getThreadRow } from "./helpers.js";
import { addPost } from "./posts.js";
import { listProjectPullRequestsForThreads } from "./pull-requests.js";

function runInTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (typeof (db as DbClient).transaction === "function") {
    return (db as DbClient).transaction((tx) => fn(tx));
  }
  return fn(db);
}

export type WorkClaimOverlap = {
  claimId: string;
  threadId: string;
  threadTitle: string;
  participantId: string;
  displayName: string;
  paths: string[];
};

function normalizeClaimPath(path: string): string {
  if (path === ".") return ".";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export function claimPathsOverlap(a: string[], b: string[]): boolean {
  for (const rawA of a) {
    const na = normalizeClaimPath(rawA);
    for (const rawB of b) {
      const nb = normalizeClaimPath(rawB);
      if (na === "." || nb === "." || na === nb) return true;
      if (na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`)) return true;
    }
  }
  return false;
}

export async function claimWork(
  db: Db,
  input: { threadId: string; participantId: string; paths: string[] },
) {
  if (input.paths.length === 0) {
    throw new GateViolation(
      'paths は 1 件以上必須です。リポジトリ全部に触るなら ["."] を明示してください',
    );
  }

  const thread = await getThreadRow(db, input.threadId);
  const actor = await getParticipant(db, input.participantId);

  const activeRows = await db
    .select()
    .from(workClaims)
    .where(
      and(eq(workClaims.projectId, thread.projectId), eq(workClaims.active, true)),
    );

  const overlapRows = activeRows.filter(
    (row) =>
      row.participantId !== input.participantId &&
      claimPathsOverlap(row.paths as string[], input.paths),
  );

  const { claim, post } = await runInTransaction(db, async (tx) => {
    const [insertedClaim] = await tx
      .insert(workClaims)
      .values({
        threadId: input.threadId,
        projectId: thread.projectId,
        participantId: input.participantId,
        paths: input.paths,
        active: true,
      })
      .returning();

    const insertedPost = await addPost(tx, {
      threadId: input.threadId,
      authorId: input.participantId,
      type: "report",
      body: `${actor.displayName} が着手を表明: ${input.paths.join(", ")}`,
    });

    await recordEvent(tx, {
      projectId: thread.projectId,
      threadId: input.threadId,
      actorParticipantId: input.participantId,
      kind: "work_claimed",
      payload: { claimId: insertedClaim!.id, paths: input.paths },
    });

    return { claim: insertedClaim!, post: insertedPost };
  });

  const overlaps: WorkClaimOverlap[] = await Promise.all(
    overlapRows.map(async (row) => {
      const other = await getParticipant(db, row.participantId);
      const overlapThread =
        row.threadId === thread.id ? thread : await getThreadRow(db, row.threadId);
      return {
        claimId: row.id,
        threadId: row.threadId,
        threadTitle: overlapThread.title,
        participantId: row.participantId,
        displayName: other.displayName,
        paths: row.paths as string[],
      };
    }),
  );

  return { claim, post, overlaps };
}

export async function releaseWork(
  db: Db,
  input: { claimId: string; actorId: string; threadId?: string },
) {
  const [claim] = await db
    .select()
    .from(workClaims)
    .where(eq(workClaims.id, input.claimId));
  if (!claim || (input.threadId !== undefined && claim.threadId !== input.threadId)) {
    throw new NotFoundError("着手表明が見つかりません");
  }
  if (claim.participantId !== input.actorId) {
    throw new PermissionDenied("解除は本人のみ可能です");
  }
  if (!claim.active) {
    return claim;
  }

  const [updated] = await db
    .update(workClaims)
    .set({ active: false, releasedAt: new Date() })
    .where(eq(workClaims.id, input.claimId))
    .returning();

  await recordEvent(db, {
    projectId: claim.projectId,
    threadId: claim.threadId,
    actorParticipantId: input.actorId,
    kind: "work_released",
    payload: { claimId: claim.id, reason: "released" },
  });

  return updated!;
}

/** Called from declare.ts when a thread is completed or rejected. Not itself a tool. */
export async function deactivateThreadClaims(
  db: Db,
  input: { threadId: string; actorId?: string | null },
) {
  const active = await db
    .select()
    .from(workClaims)
    .where(and(eq(workClaims.threadId, input.threadId), eq(workClaims.active, true)));
  if (active.length === 0) {
    return [];
  }

  const updated = await db
    .update(workClaims)
    .set({ active: false, releasedAt: new Date() })
    .where(and(eq(workClaims.threadId, input.threadId), eq(workClaims.active, true)))
    .returning();

  for (const claim of updated) {
    await recordEvent(db, {
      projectId: claim.projectId,
      threadId: claim.threadId,
      actorParticipantId: input.actorId ?? null,
      kind: "work_released",
      payload: { claimId: claim.id, reason: "thread_closed" },
    });
  }
  return updated;
}

export function uniqueClaimantDisplayNames(
  claims: ReadonlyArray<{ participantId: string; displayName: string }>,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const claim of claims) {
    if (seen.has(claim.participantId)) {
      continue;
    }
    seen.add(claim.participantId);
    names.push(claim.displayName);
  }
  return names;
}

export function activeClaimantsByThreadId(
  claims: ReadonlyArray<{
    threadId: string;
    participantId: string;
    displayName: string;
  }>,
): Map<string, string[]> {
  const grouped = new Map<
    string,
    Array<{ participantId: string; displayName: string }>
  >();
  for (const claim of claims) {
    const list = grouped.get(claim.threadId) ?? [];
    list.push({
      participantId: claim.participantId,
      displayName: claim.displayName,
    });
    grouped.set(claim.threadId, list);
  }
  const result = new Map<string, string[]>();
  for (const [threadId, threadClaims] of grouped) {
    result.set(threadId, uniqueClaimantDisplayNames(threadClaims));
  }
  return result;
}

export type ActiveWorkClaim = {
  id: string;
  threadId: string;
  threadTitle: string;
  participantId: string;
  displayName: string;
  paths: string[];
  createdAt: string;
};

export async function listActiveProjectClaims(
  db: Db,
  projectId: string,
): Promise<ActiveWorkClaim[]> {
  const rows = await db
    .select({
      id: workClaims.id,
      threadId: workClaims.threadId,
      threadTitle: threads.title,
      participantId: workClaims.participantId,
      displayName: participants.displayName,
      paths: workClaims.paths,
      createdAt: workClaims.createdAt,
    })
    .from(workClaims)
    .innerJoin(threads, eq(workClaims.threadId, threads.id))
    .innerJoin(participants, eq(workClaims.participantId, participants.id))
    .where(and(eq(workClaims.projectId, projectId), eq(workClaims.active, true)))
    .orderBy(asc(workClaims.createdAt));

  return rows.map((row) => ({
    ...row,
    paths: row.paths as string[],
    createdAt: row.createdAt.toISOString(),
  }));
}

export type ThreadWorkClaim = {
  id: string;
  participantId: string;
  displayName: string;
  paths: string[];
  createdAt: string;
};

export async function listActiveThreadClaims(
  db: Db,
  threadId: string,
): Promise<ThreadWorkClaim[]> {
  const rows = await db
    .select({
      id: workClaims.id,
      participantId: workClaims.participantId,
      displayName: participants.displayName,
      paths: workClaims.paths,
      createdAt: workClaims.createdAt,
    })
    .from(workClaims)
    .innerJoin(participants, eq(workClaims.participantId, participants.id))
    .where(and(eq(workClaims.threadId, threadId), eq(workClaims.active, true)))
    .orderBy(asc(workClaims.createdAt));

  return rows.map((row) => ({
    ...row,
    paths: row.paths as string[],
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listUnclaimedDecidedImplementations(
  db: Db,
  projectId: string,
): Promise<Array<{ id: string; title: string }>> {
  const rows = await db
    .select({ id: threads.id, title: threads.title })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, projectId),
        eq(threads.state, "decided"),
        eq(threads.type, "implementation"),
      ),
    );
  if (rows.length === 0) {
    return [];
  }

  const threadIds = rows.map((row) => row.id);
  const claimedRows = await db
    .select({ threadId: workClaims.threadId })
    .from(workClaims)
    .where(and(inArray(workClaims.threadId, threadIds), eq(workClaims.active, true)));
  const claimed = new Set(claimedRows.map((row) => row.threadId));
  const prByThread = await listProjectPullRequestsForThreads(db, threadIds);

  return rows.filter(
    (row) => !claimed.has(row.id) && (prByThread.get(row.id)?.length ?? 0) === 0,
  );
}

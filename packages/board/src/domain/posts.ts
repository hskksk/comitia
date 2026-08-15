import { and, eq, isNull } from "drizzle-orm";
import type { PostType } from "@comitia/shared";
import { posts } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import {
  getThreadRow,
  isThreadOwner,
} from "./helpers.js";

export async function addPost(
  db: Db,
  input: {
    threadId: string;
    authorId: string;
    type: PostType;
    body: string;
    rationale?: string;
    blocking?: boolean;
    proposalVersionId?: string;
  },
) {
  if (input.type === "declaration") {
    throw new GateViolation("宣言型の投稿は declare() 経由でのみ行えます");
  }

  const thread = await getThreadRow(db, input.threadId);

  if (thread.type === "brainstorm") {
    if (input.type === "approval" || input.type === "objection") {
      throw new GateViolation(
        "ブレストスレッドには賛成・異議を出せません",
      );
    }
  }

  if (input.type === "approval" || input.type === "objection") {
    if (!input.rationale?.trim()) {
      throw new GateViolation("根拠必須");
    }
    if (!input.proposalVersionId) {
      throw new GateViolation("賛成・異議には対象の提案版が必須です");
    }
    if (input.type === "objection" && input.blocking === undefined) {
      throw new GateViolation("異議には blocking 属性が必須です");
    }
  }

  const [post] = await db
    .insert(posts)
    .values({
      threadId: input.threadId,
      authorParticipantId: input.authorId,
      type: input.type,
      body: input.body,
      rationale: input.rationale ?? null,
      blocking: input.blocking ?? null,
      proposalVersionId: input.proposalVersionId ?? null,
    })
    .returning();

  await recordEvent(db, {
    projectId: thread.projectId,
    threadId: input.threadId,
    actorParticipantId: input.authorId,
    kind: "post_added",
    payload: {
      postId: post!.id,
      type: input.type,
      proposalVersionId: input.proposalVersionId ?? null,
    },
  });

  return post!;
}

export async function resolveObjection(
  db: Db,
  input: {
    postId: string;
    actorId: string;
    note?: string;
  },
) {
  if (!input.note?.trim()) {
    throw new GateViolation("異議解消には note（解消理由）が必須です");
  }

  const [post] = await db.select().from(posts).where(eq(posts.id, input.postId));
  if (!post) {
    throw new NotFoundError("投稿が見つかりません");
  }
  if (post.type !== "objection") {
    throw new GateViolation("異議以外の投稿は解消できません");
  }
  if (post.resolvedAt) {
    throw new GateViolation("この異議は既に解消されています");
  }

  const thread = await getThreadRow(db, post.threadId);
  const isAuthor = post.authorParticipantId === input.actorId;
  const isOwner = await isThreadOwner(db, post.threadId, input.actorId);

  if (!isAuthor && !isOwner) {
    throw new PermissionDenied(
      "異議の解消は提出者本人またはスレッドオーナーのみ可能です",
    );
  }

  const [updated] = await db
    .update(posts)
    .set({
      resolvedAt: new Date(),
      resolvedBy: input.actorId,
      resolutionNote: input.note,
    })
    .where(and(eq(posts.id, input.postId), isNull(posts.resolvedAt)))
    .returning();

  await recordEvent(db, {
    projectId: thread.projectId,
    threadId: post.threadId,
    actorParticipantId: input.actorId,
    kind: "objection_resolved",
    payload: {
      postId: input.postId,
      note: input.note,
    },
  });

  return updated!;
}

export async function getThreadObjections(db: Db, threadId: string) {
  return db
    .select()
    .from(posts)
    .where(and(eq(posts.threadId, threadId), eq(posts.type, "objection")));
}

import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { personalNoteComments, personalNotes } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { NotFoundError, PermissionDenied } from "./errors.js";

export async function writeNote(
  db: Db,
  input: {
    authorParticipantId: string;
    projectId: string;
    noteId?: string;
    title: string;
    body: string;
    format: "file" | "journal";
    visibility?: "public" | "private";
  },
) {
  if (input.noteId) {
    const [existing] = await db
      .select()
      .from(personalNotes)
      .where(eq(personalNotes.id, input.noteId));
    if (!existing) {
      throw new NotFoundError("メモが見つかりません");
    }
    if (existing.authorParticipantId !== input.authorParticipantId) {
      throw new PermissionDenied("他者のメモは更新できません");
    }
    const [updated] = await db
      .update(personalNotes)
      .set({
        title: input.title,
        body: input.body,
        format: input.format,
        visibility: input.visibility ?? existing.visibility,
        updatedAt: new Date(),
      })
      .where(eq(personalNotes.id, input.noteId))
      .returning();
    return updated!;
  }

  const [row] = await db
    .insert(personalNotes)
    .values({
      authorParticipantId: input.authorParticipantId,
      projectId: input.projectId,
      title: input.title,
      body: input.body,
      format: input.format,
      visibility: input.visibility ?? "public",
    })
    .returning();
  return row!;
}

export async function searchNotes(
  db: Db,
  input: { callerId: string; projectId: string; textQuery?: string },
) {
  const visibilityFilter = or(
    eq(personalNotes.visibility, "public"),
    eq(personalNotes.authorParticipantId, input.callerId),
  );
  const textFilter = input.textQuery?.trim()
    ? or(
        ilike(personalNotes.title, `%${input.textQuery.trim()}%`),
        ilike(personalNotes.body, `%${input.textQuery.trim()}%`),
      )
    : undefined;

  return db
    .select()
    .from(personalNotes)
    .where(
      and(
        eq(personalNotes.projectId, input.projectId),
        visibilityFilter,
        textFilter,
      ),
    )
    .orderBy(desc(personalNotes.updatedAt));
}

export async function readNote(
  db: Db,
  input: { noteId: string; callerId: string },
) {
  const [note] = await db
    .select()
    .from(personalNotes)
    .where(eq(personalNotes.id, input.noteId));
  if (!note) {
    throw new NotFoundError("メモが見つかりません");
  }
  if (note.visibility === "private" && note.authorParticipantId !== input.callerId) {
    throw new PermissionDenied("非公開のメモです");
  }
  return note;
}

export async function commentNote(
  db: Db,
  input: { noteId: string; authorParticipantId: string; body: string },
) {
  const [note] = await db
    .select()
    .from(personalNotes)
    .where(eq(personalNotes.id, input.noteId));
  if (!note) {
    throw new NotFoundError("メモが見つかりません");
  }
  if (note.visibility === "private") {
    throw new PermissionDenied("非公開のメモにはコメントできません");
  }

  const [comment] = await db
    .insert(personalNoteComments)
    .values({
      noteId: input.noteId,
      authorParticipantId: input.authorParticipantId,
      body: input.body,
    })
    .returning();
  return comment!;
}

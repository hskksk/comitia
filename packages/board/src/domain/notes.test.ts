import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { registerParticipant } from "./participants.js";
import { NotFoundError, PermissionDenied } from "./errors.js";
import { commentNote, readNote, searchNotes, writeNote } from "./notes.js";

describe("writeNote", () => {
  it("creates a public note by default", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);

    const note = await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "気づき",
      body: "本文",
      format: "journal",
    });

    expect(note.visibility).toBe("public");
    expect(note.authorParticipantId).toBe(agent.id);
  });

  it("updates the author's own note in place", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const note = await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "気づき",
      body: "本文 v1",
      format: "journal",
    });

    const updated = await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      noteId: note.id,
      title: "気づき",
      body: "本文 v2",
      format: "journal",
    });

    expect(updated.id).toBe(note.id);
    expect(updated.body).toBe("本文 v2");
  });

  it("rejects updating another participant's note (ownership never transfers)", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const other = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const note = await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "気づき",
      body: "本文",
      format: "journal",
    });

    await expect(
      writeNote(db, {
        authorParticipantId: other.id,
        projectId: project.id,
        noteId: note.id,
        title: "乗っ取り",
        body: "書き換え",
        format: "journal",
      }),
    ).rejects.toThrow(PermissionDenied);
  });
});

describe("searchNotes / readNote", () => {
  it("returns public notes and the caller's own private notes, not others' private notes", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const other = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "公開メモ",
      body: "本文",
      format: "file",
      visibility: "public",
    });
    await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "自分の非公開メモ",
      body: "本文",
      format: "file",
      visibility: "private",
    });
    await writeNote(db, {
      authorParticipantId: other.id,
      projectId: project.id,
      title: "他者の非公開メモ",
      body: "本文",
      format: "file",
      visibility: "private",
    });

    const results = await searchNotes(db, { callerId: agent.id, projectId: project.id });
    const titles = results.map((r) => r.title);
    expect(titles).toContain("公開メモ");
    expect(titles).toContain("自分の非公開メモ");
    expect(titles).not.toContain("他者の非公開メモ");
  });

  it("readNote rejects reading another participant's private note", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const other = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const note = await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "非公開メモ",
      body: "本文",
      format: "file",
      visibility: "private",
    });

    await expect(readNote(db, { noteId: note.id, callerId: other.id })).rejects.toThrow(
      PermissionDenied,
    );
    await expect(
      readNote(db, { noteId: note.id, callerId: agent.id }),
    ).resolves.toMatchObject({ id: note.id });
  });

  it("readNote throws NotFoundError for a missing note", async () => {
    const { agent } = await seedOwnerAgentProject(db);
    await expect(
      readNote(db, {
        noteId: "00000000-0000-4000-8000-000000000001",
        callerId: agent.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("commentNote", () => {
  it("comments on a public note", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const other = await registerParticipant(db, {
      kind: "agent",
      displayName: "リン",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const note = await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "公開メモ",
      body: "本文",
      format: "file",
      visibility: "public",
    });

    const comment = await commentNote(db, {
      noteId: note.id,
      authorParticipantId: other.id,
      body: "助言です",
    });
    expect(comment.noteId).toBe(note.id);
  });

  it("rejects commenting on a private note, even by the author", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const note = await writeNote(db, {
      authorParticipantId: agent.id,
      projectId: project.id,
      title: "非公開メモ",
      body: "本文",
      format: "file",
      visibility: "private",
    });

    await expect(
      commentNote(db, { noteId: note.id, authorParticipantId: agent.id, body: "自分にメモ" }),
    ).rejects.toThrow(PermissionDenied);
  });
});

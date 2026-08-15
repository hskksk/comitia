import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { sessions } from "../db/schema.js";
import { getBriefing } from "./briefing.js";
import { endSession, findOpenSession, openOrGetSession } from "./sessions.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";

describe("sessions", () => {
  async function setupParticipants() {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
      engine: "claude",
    });
    const project = await createProject(db, {
      name: "comitia-web",
      ownerParticipantId: owner.id,
    });
    return { owner, agent, project };
  }

  it("briefing opens a session; second briefing reuses the same session", async () => {
    const { agent, project } = await setupParticipants();

    const first = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    const second = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(first.sessionId).toBe(second.sessionId);

    const open = await findOpenSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(open?.id).toBe(first.sessionId);
  });

  it("end_session without handover fails; with handover succeeds", async () => {
    const { agent, project } = await setupParticipants();
    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    await expect(
      endSession(db, { sessionId: session.id, handover: "   " }),
    ).rejects.toThrow(/申し送り/);

    const ended = await endSession(db, {
      sessionId: session.id,
      handover: "README typo を修正した",
    });
    expect(ended.endedAt).not.toBeNull();

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(row?.endedAt).not.toBeNull();
    expect(row?.endedReason).toBe("completed");
  });
});

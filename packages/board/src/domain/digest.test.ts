import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { events, sessions } from "../db/schema.js";
import { getBriefing } from "./briefing.js";
import {
  endSession,
  findUndigestedSession,
  interruptStaleSessions,
  markSessionDigested,
  prepareSessionStart,
} from "./sessions.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";

async function setup() {
  const owner = await registerParticipant(db, {
    kind: "human",
    displayName: "ハル",
  });
  const agent = await registerParticipant(db, {
    kind: "agent",
    displayName: "ミカ",
    ownerParticipantId: owner.id,
    engine: "claude-code",
  });
  const project = await createProject(db, {
    name: "comitia",
    ownerParticipantId: owner.id,
  });
  return { agent, project };
}

describe("session digest", () => {
  it("prepareSessionStart leaves briefingAt null; get_briefing digests", async () => {
    const { agent, project } = await setup();
    const prepared = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(prepared.briefingAt).toBeNull();
    expect(
      (await findUndigestedSession(db, {
        participantId: agent.id,
        projectId: project.id,
      }))?.id,
    ).toBe(prepared.id);

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(briefing.sessionId).toBe(prepared.id);

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, prepared.id));
    expect(row?.briefingAt).not.toBeNull();
    expect(
      await findUndigestedSession(db, {
        participantId: agent.id,
        projectId: project.id,
      }),
    ).toBeNull();
  });

  it("second prepareSessionStart reuses the open session", async () => {
    const { agent, project } = await setup();
    const a = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    const b = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(a.id).toBe(b.id);
  });

  it("interruptStaleSessions closes digested sessions past timeout", async () => {
    const { agent, project } = await setup();
    const session = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await markSessionDigested(db, session.id);
    await db
      .update(sessions)
      .set({ startedAt: new Date(Date.now() - 40 * 60_000) })
      .where(eq(sessions.id, session.id));

    const n = await interruptStaleSessions(db, {
      now: new Date(),
      timeoutMs: 30 * 60_000,
    });
    expect(n).toBe(1);
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(row?.endedReason).toBe("interrupted");
    expect(row?.endedAt).not.toBeNull();
  });

  it("markSessionDigested is idempotent", async () => {
    const { agent, project } = await setup();
    const session = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    const first = await markSessionDigested(db, session.id);
    const second = await markSessionDigested(db, session.id);

    expect(second.briefingAt).toEqual(first.briefingAt);
    const recorded = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.projectId, project.id),
          eq(events.kind, "session_digested"),
        ),
      );
    expect(recorded).toHaveLength(1);
  });

  it("does not interrupt undigested or fresh sessions", async () => {
    const { agent, project } = await setup();
    const undigested = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await db
      .update(sessions)
      .set({ startedAt: new Date(Date.now() - 40 * 60_000) })
      .where(eq(sessions.id, undigested.id));

    const n = await interruptStaleSessions(db, {
      now: new Date(),
      timeoutMs: 30 * 60_000,
    });

    expect(n).toBe(0);
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, undigested.id));
    expect(row?.endedAt).toBeNull();
  });

  it("reports interruption instead of an older handover", async () => {
    const { agent, project } = await setup();
    const completed = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await markSessionDigested(db, completed.id);
    await endSession(db, {
      sessionId: completed.id,
      handover: "古い申し送り",
    });

    const session = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await markSessionDigested(db, session.id);
    await db
      .update(sessions)
      .set({ startedAt: new Date(Date.now() - 40 * 60_000) })
      .where(eq(sessions.id, session.id));
    await interruptStaleSessions(db, {
      now: new Date(),
      timeoutMs: 30 * 60_000,
    });

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(briefing.situation.previous_interrupted).toBe(true);
    expect(briefing.handover).toBe("");
  });
});

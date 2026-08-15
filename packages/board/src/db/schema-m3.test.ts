import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { agentConnections, agentCredentials, ticks } from "../db/schema.js";
import { registerParticipant } from "../domain/participants.js";
import { createProject } from "../domain/projects.js";
import { openOrGetSession } from "../domain/sessions.js";

describe("M3 schema", () => {
  it("stores credential hash, connection row, tick, and briefingAt", async () => {
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

    await db.insert(agentCredentials).values({
      participantId: agent.id,
      projectId: project.id,
      tokenHash: "abc",
    });
    await db.insert(agentConnections).values({
      participantId: agent.id,
      status: "disconnected",
      sessionStartMinute: 30,
    });
    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(session.briefingAt).toBeNull();
    expect(session.endedReason).toBeNull();

    await db.insert(ticks).values({
      id: "11111111-1111-4111-8111-111111111111",
      participantId: agent.id,
      sessionId: session.id,
      type: "session.start",
      status: "queued",
      sequence: 1,
    });

    const [tick] = await db.select().from(ticks);
    expect(tick?.status).toBe("queued");
  });
});

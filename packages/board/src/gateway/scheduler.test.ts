import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { agentConnections, sessions, ticks } from "../db/schema.js";
import { bootstrapBoard, registerAgent } from "../domain/bootstrap.js";
import { endSession } from "../domain/sessions.js";
import type { BoardGateway } from "../http/app.js";
import type { Relay } from "./relay.js";
import { sendTick } from "./send-tick.js";
import { runScheduler } from "./scheduler.js";

function offlineRelay(): Relay {
  return {
    baseUrl: "",
    isConnected: () => false,
    handleHttp: () => {},
    handleUpgrade: () => {},
    disconnect: () => {},
    close: () => {},
  };
}

describe("runScheduler", () => {
  it("starts once at the offset minute, skips the same UTC day after end, and fires the next day", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const registered = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "ミカ",
      engine: "claude-code",
    });
    await db
      .update(agentConnections)
      .set({ sessionStartMinute: 30 })
      .where(eq(agentConnections.participantId, registered.agent.id));

    const relay = offlineRelay();
    const send: BoardGateway["sendTick"] = (input) =>
      sendTick(db, relay, input);

    const now = new Date("2026-08-16T00:30:00Z");
    await runScheduler(db, send, { now });

    const afterFirst = await db
      .select()
      .from(ticks)
      .where(eq(ticks.participantId, registered.agent.id));
    const firstStarts = afterFirst.filter((row) => row.type === "session.start");
    expect(firstStarts).toHaveLength(1);
    const sessionId = firstStarts[0]!.sessionId;
    expect(sessionId).toBeTruthy();

    await db
      .update(sessions)
      .set({ startedAt: now })
      .where(eq(sessions.id, sessionId!));

    await runScheduler(db, send, { now });
    const afterSecond = await db
      .select()
      .from(ticks)
      .where(eq(ticks.participantId, registered.agent.id));
    expect(
      afterSecond.filter((row) => row.type === "session.start"),
    ).toHaveLength(1);

    await endSession(db, {
      sessionId: sessionId!,
      handover: "today's work is done",
    });

    await runScheduler(db, send, { now });
    const afterSameDay = await db
      .select()
      .from(ticks)
      .where(eq(ticks.participantId, registered.agent.id));
    expect(
      afterSameDay.filter((row) => row.type === "session.start"),
    ).toHaveLength(1);

    await runScheduler(db, send, { now: new Date("2026-08-17T00:30:00Z") });
    const afterNextDay = await db
      .select()
      .from(ticks)
      .where(eq(ticks.participantId, registered.agent.id));
    expect(
      afterNextDay.filter((row) => row.type === "session.start"),
    ).toHaveLength(2);
  });
});

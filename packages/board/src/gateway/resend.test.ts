import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GATEWAY } from "@comitia/shared";
import { db } from "../test/helpers.js";
import { sessions, ticks } from "../db/schema.js";
import { bootstrapBoard, registerAgent } from "../domain/bootstrap.js";
import { prepareSessionStart } from "../domain/sessions.js";
import type { BoardGateway } from "../http/app.js";
import type { Relay } from "./relay.js";
import { sendTick } from "./send-tick.js";
import { resendUndigested } from "./resend.js";

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

describe("resendUndigested", () => {
  it("resends session.start for an undigested session past timeout with the same sessionId", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const registered = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "ミカ",
      engine: "claude-code",
    });
    const relay = offlineRelay();
    const send: BoardGateway["sendTick"] = (input) =>
      sendTick(db, relay, input);

    const session = await prepareSessionStart(db, {
      participantId: registered.agent.id,
      projectId: registered.projectId,
    });
    const first = await send({
      participantId: registered.agent.id,
      type: "session.start",
    });
    expect(first.sessionId).toBe(session.id);
    expect(first.status).toBe("queued");

    const now = new Date("2026-08-16T00:30:00Z");
    await db
      .update(sessions)
      .set({ startedAt: new Date(now.getTime() - 61_000) })
      .where(eq(sessions.id, session.id));

    await resendUndigested(db, send, {
      now,
      timeoutMs: GATEWAY.digestTimeoutMs,
    });

    const rows = await db
      .select()
      .from(ticks)
      .where(eq(ticks.participantId, registered.agent.id));
    const startTicks = rows.filter((row) => row.type === "session.start");
    expect(startTicks.length).toBe(2);
    expect(startTicks.every((row) => row.sessionId === session.id)).toBe(true);
    expect(
      startTicks.every(
        (row) => row.status === "queued" || row.status === "delivered",
      ),
    ).toBe(true);
    expect(startTicks.some((row) => row.id !== first.tickId)).toBe(true);
  });
});

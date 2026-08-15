import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GATEWAY } from "@comitia/shared";
import { db } from "../test/helpers.js";
import { agentConnections } from "../db/schema.js";
import { bootstrapBoard, registerAgent } from "../domain/bootstrap.js";
import { expireStaleConnections, touchConnection } from "./health.js";

describe("connection health", () => {
  it("touchConnection updates lastSeenAt and expireStaleConnections disconnects after ttl", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const registered = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "ミカ",
      engine: "claude-code",
    });

    const seenAt = new Date("2026-08-16T00:00:00Z");
    await db
      .update(agentConnections)
      .set({ status: "connected" })
      .where(eq(agentConnections.participantId, registered.agent.id));
    await touchConnection(db, registered.agent.id, seenAt);

    const [touched] = await db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.participantId, registered.agent.id));
    expect(touched?.status).toBe("connected");
    expect(touched?.lastSeenAt?.toISOString()).toBe(seenAt.toISOString());

    const expiredIds = await expireStaleConnections(db, {
      now: new Date(seenAt.getTime() + GATEWAY.healthTtlMs + 1),
      ttlMs: GATEWAY.healthTtlMs,
    });
    expect(expiredIds).toEqual([registered.agent.id]);

    const [expired] = await db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.participantId, registered.agent.id));
    expect(expired?.status).toBe("disconnected");
  });
});

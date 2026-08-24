import "../test/helpers.js";
import { ClientFactory } from "@a2a-js/sdk/client";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { agentConnections, sessions, ticks } from "../db/schema.js";
import { bootstrapBoard, registerAgent } from "../domain/bootstrap.js";
import { db } from "../test/helpers.js";
import { startBoardServer } from "../http/server.js";
import { sendTick } from "./send-tick.js";
import { buildRelayWsUrl, createTestAdapter } from "./test-adapter.js";

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for condition");
}

describe("WS relay mailbox and A2A tick send", () => {
  let closeAdapter: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeAdapter?.();
    closeAdapter = undefined;
    await closeServer?.();
    closeServer = undefined;
  });

  it(
    "covers connect, agent card, deliver, queue, flush, and undigested resend",
    async () => {
      const boot = await bootstrapBoard(db, {
        ownerDisplayName: "ハル",
        projectName: "comitia",
      });
      const registered = await registerAgent(db, {
        ownerParticipantId: boot.owner.id,
        displayName: "ミカ",
        engine: "claude-code",
      });
      const agentId = registered.agent.id;
      const agentToken = registered.agentToken;

      const server = await startBoardServer({ db, port: 0 });
      closeServer = server.close;

      const adapter = await createTestAdapter({
        agentId,
        relayBaseUrl: server.baseUrl,
      });
      closeAdapter = adapter.close;

      // 1. Server start, adapter connect
      await adapter.connect(buildRelayWsUrl(server.baseUrl, agentId, agentToken));
      await waitFor(
        () => adapter.isConnected() && server.relay.isConnected(agentId),
      );
      expect(adapter.isConnected()).toBe(true);
      expect(server.relay.isConnected(agentId)).toBe(true);

      const [connection] = await db
        .select()
        .from(agentConnections)
        .where(eq(agentConnections.participantId, agentId));
      expect(connection?.status).toBe("connected");

      // 2. Agent Card over the tunnel
      const factory = new ClientFactory();
      const client = await factory.createFromUrl(
        `${server.baseUrl}/agents/${agentId}/`,
      );
      const card = await client.getAgentCard();
      expect(card.name).toContain(agentId);

      // 3. session.start delivered immediately; undigested session exists
      const tick1 = await sendTick(db, server.relay, {
        participantId: agentId,
        type: "session.start",
      });
      expect(tick1.status).toBe("delivered");
      expect(tick1.sessionId).toBeTruthy();
      await waitFor(() => adapter.getReceivedTickIds().includes(tick1.tickId));

      const [tick1Row] = await db
        .select()
        .from(ticks)
        .where(eq(ticks.id, tick1.tickId));
      expect(tick1Row?.status).toBe("delivered");

      const [sessionRow] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, tick1.sessionId!));
      expect(sessionRow?.briefingAt).toBeNull();
      expect(sessionRow?.endedAt).toBeNull();

      // 4. Adapter disconnect
      adapter.disconnect();
      await waitFor(
        () => !adapter.isConnected() && !server.relay.isConnected(agentId),
      );
      expect(server.relay.isConnected(agentId)).toBe(false);

      // 5. Ticks while disconnected are queued
      const tick2 = await sendTick(db, server.relay, {
        participantId: agentId,
        type: "nudge",
      });
      const tick3 = await sendTick(db, server.relay, {
        participantId: agentId,
        type: "session.end_warning",
      });
      expect(tick2.status).toBe("queued");
      expect(tick3.status).toBe("queued");

      const queuedRows = await db
        .select()
        .from(ticks)
        .where(eq(ticks.participantId, agentId));
      const queuedStatuses = Object.fromEntries(
        queuedRows.map((row) => [row.id, row.status]),
      );
      expect(queuedStatuses[tick2.tickId]).toBe("queued");
      expect(queuedStatuses[tick3.tickId]).toBe("queued");

      // 6. Reconnect flushes mailbox in order
      await adapter.connect(buildRelayWsUrl(server.baseUrl, agentId, agentToken));
      await waitFor(() => {
        const ids = adapter.getReceivedTickIds();
        return ids.includes(tick2.tickId) && ids.includes(tick3.tickId);
      });

      const idsAfterFlush = adapter.getReceivedTickIds();
      const flushOrder = idsAfterFlush.filter(
        (id) => id === tick2.tickId || id === tick3.tickId,
      );
      expect(flushOrder).toEqual([tick2.tickId, tick3.tickId]);

      // 7. Delivered tick ids have no gaps (ignore in-flight undigested resend)
      const sentIds = [tick1.tickId, tick2.tickId, tick3.tickId];
      const receivedIds = adapter.getReceivedTickIds();
      for (const id of sentIds) {
        expect(receivedIds).toContain(id);
      }
      expect(receivedIds.slice(0, 3)).toEqual(sentIds);

      await waitFor(async () => {
        const rows = await db
          .select()
          .from(ticks)
          .where(eq(ticks.participantId, agentId));
        return sentIds.every(
          (id) => rows.find((row) => row.id === id)?.status === "delivered",
        );
      });

      const deliveredRows = (
        await db
          .select()
          .from(ticks)
          .where(eq(ticks.participantId, agentId))
      ).filter((row) => sentIds.includes(row.id));
      const sequences = deliveredRows
        .map((row) => row.sequence)
        .sort((a, b) => a - b);
      expect(sequences).toEqual(
        Array.from({ length: sequences.length }, (_, i) => i + 1),
      );
      expect(deliveredRows.every((row) => row.status === "delivered")).toBe(
        true,
      );

      // 8. Undigested session is resent on reconnect (new tick id, same sessionId)
      await waitFor(() =>
        adapter
          .getReceivedTicks()
          .some(
            (tick) =>
              tick.type === "session.start" &&
              tick.id !== tick1.tickId &&
              tick.sessionId === tick1.sessionId,
          ),
      );
      const resent = adapter
        .getReceivedTicks()
        .find(
          (tick) =>
            tick.type === "session.start" &&
            tick.id !== tick1.tickId &&
            tick.sessionId === tick1.sessionId,
        );
      expect(resent).toBeDefined();
      expect(resent?.id).not.toBe(tick1.tickId);
      expect(resent?.sessionId).toBe(tick1.sessionId);
    },
    30_000,
  );
});

import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { getRequestListener } from "@hono/node-server";
import type { TickType } from "@comitia/shared";
import { agentConnections, agentCredentials } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { authenticateToken } from "../domain/credentials.js";
import { recordEvent } from "../domain/events.js";
import { findUndigestedSession } from "../domain/sessions.js";
import { createRelay, type Relay } from "../gateway/relay.js";
import {
  flushMailbox,
  sendTick,
  type SendTickResult,
} from "../gateway/send-tick.js";
import { createBoardApp, type BoardGateway } from "./app.js";

export async function startBoardServer(input: {
  db: Db;
  port?: number;
}): Promise<{
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
  relay: Relay;
  app: ReturnType<typeof createBoardApp>;
  sendTick: (input: {
    participantId: string;
    type: TickType;
  }) => Promise<SendTickResult>;
}> {
  const { db } = input;
  let relay: Relay;
  let send: BoardGateway["sendTick"] = async () => {
    throw new Error("gateway is not ready");
  };

  const app = createBoardApp({
    db,
    getGateway: () => ({ sendTick: (payload) => send(payload) }),
  });

  relay = createRelay({
    authenticate: async (agentId, token) => {
      const auth = await authenticateToken(db, token);
      return (
        auth !== null &&
        auth.participant.id === agentId &&
        auth.participant.kind === "agent"
      );
    },
    onConnect: async ({ agentId }) => {
      const [cred] = await db
        .select()
        .from(agentCredentials)
        .where(eq(agentCredentials.participantId, agentId))
        .limit(1);
      if (!cred) {
        return;
      }
      await db
        .update(agentConnections)
        .set({ status: "connected", lastSeenAt: new Date() })
        .where(eq(agentConnections.participantId, agentId));
      await recordEvent(db, {
        projectId: cred.projectId,
        actorParticipantId: agentId,
        kind: "agent_connected",
        payload: { participantId: agentId },
      });
      await flushMailbox(db, relay, agentId);
      const undigested = await findUndigestedSession(db, {
        participantId: agentId,
        projectId: cred.projectId,
      });
      if (undigested) {
        await sendTick(db, relay, {
          participantId: agentId,
          type: "session.start",
        });
      }
    },
    onDisconnect: async ({ agentId }) => {
      const [cred] = await db
        .select()
        .from(agentCredentials)
        .where(eq(agentCredentials.participantId, agentId))
        .limit(1);
      await db
        .update(agentConnections)
        .set({ status: "disconnected" })
        .where(eq(agentConnections.participantId, agentId));
      if (cred) {
        await recordEvent(db, {
          projectId: cred.projectId,
          actorParticipantId: agentId,
          kind: "agent_disconnected",
          payload: { participantId: agentId },
        });
      }
    },
  });

  const listener = getRequestListener(app.fetch);
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path.startsWith("/agents/")) {
      relay.handleHttp(req, res);
      return;
    }
    listener(req, res);
  });
  server.on("upgrade", (req, socket, head) => {
    relay.handleUpgrade(req, socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 0, () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("server address is unavailable");
  }
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  relay.baseUrl = baseUrl;
  send = (payload) => sendTick(db, relay, payload);

  return {
    port,
    baseUrl,
    relay,
    app,
    sendTick: send,
    close: async () => {
      relay.close();
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

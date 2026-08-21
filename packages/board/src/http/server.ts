import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { getRequestListener } from "@hono/node-server";
import { GATEWAY, type TickType } from "@comitia/shared";
import { agentConnections, agentCredentials } from "../db/schema.js";
import type { Db, DbClient } from "../db/types.js";
import { authenticateToken } from "../domain/credentials.js";
import { recordEvent } from "../domain/events.js";
import {
  findUndigestedSession,
  interruptStaleSessions,
} from "../domain/sessions.js";
import { evaluateTimedConsensus } from "../domain/timed-consensus.js";
import { expireStaleConnections, touchConnection } from "../gateway/health.js";
import { createRelay, type Relay } from "../gateway/relay.js";
import { resendUndigested } from "../gateway/resend.js";
import { runScheduler } from "../gateway/scheduler.js";
import {
  flushMailbox,
  sendTick,
  type SendTickInput,
  type SendTickResult,
} from "../gateway/send-tick.js";
import { createBoardApp, type BoardGateway } from "./app.js";
import { readGitHubConfig } from "../github/config.js";
import { createOctokitGitHubClient } from "../github/octokit-client.js";
import { attachSpaFallback, resolveWebDist } from "./static-web.js";

export function startLoops(input: {
  db: DbClient;
  send: (payload: SendTickInput) => Promise<SendTickResult>;
  relay: Relay;
  now?: () => Date;
  intervalMs?: number;
}): () => void {
  const getNow = input.now ?? (() => new Date());
  const intervalMs = input.intervalMs ?? 15_000;
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void runLoopTick(input, getNow).finally(() => {
      running = false;
    });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function runLoopTick(
  input: {
    db: DbClient;
    send: (payload: SendTickInput) => Promise<SendTickResult>;
    relay: Relay;
  },
  getNow: () => Date,
): Promise<void> {
  const now = getNow();
  try {
    const expired = await expireStaleConnections(input.db, {
      now,
      ttlMs: GATEWAY.healthTtlMs,
    });
    for (const participantId of expired) {
      input.relay.disconnect(participantId);
    }
    await resendUndigested(input.db, input.send, {
      now,
      timeoutMs: GATEWAY.digestTimeoutMs,
    });
    await interruptStaleSessions(input.db, {
      now,
      timeoutMs: GATEWAY.sessionTimeoutMs,
    });
    if (now.getUTCSeconds() < 15) {
      await runScheduler(input.db, input.send, { now });
    }
    await evaluateTimedConsensus(input.db, { now });
  } catch (error) {
    console.error(error);
  }
}

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

  const githubConfig = readGitHubConfig();
  const github =
    githubConfig.installationReady && githubConfig.oauthEnabled
      ? createOctokitGitHubClient(githubConfig)
      : undefined;

  const app = createBoardApp({
    db,
    getGateway: () => ({ sendTick: (payload) => send(payload) }),
    github,
    githubPublicBaseUrl: githubConfig.publicUrl,
    webhookSecret: githubConfig.webhookSecret,
    githubOAuth: {
      enabled: githubConfig.oauthEnabled,
      appSlug: githubConfig.appSlug,
      clientId: githubConfig.clientId,
    },
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
    onPong: async ({ agentId }) => {
      await touchConnection(db, agentId, new Date());
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
  const webDist = resolveWebDist();
  if (webDist) {
    attachSpaFallback(server, webDist);
  }

  const host = process.env.HOST ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 0, host, () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("server address is unavailable");
  }
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  relay.baseUrl = baseUrl;
  send = (payload) => sendTick(db, relay, payload);
  const stopLoops = startLoops({
    db: db as DbClient,
    send: (payload) => send(payload),
    relay,
  });

  return {
    port,
    baseUrl,
    relay,
    app,
    sendTick: send,
    close: async () => {
      stopLoops();
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

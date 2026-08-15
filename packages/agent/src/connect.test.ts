import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import {
  bootstrapBoard,
  registerAgent,
  schema,
  startBoardServer,
} from "@comitia/board";
import type { Tick } from "@comitia/shared";
import { startLocalA2aServer } from "./a2a-server.js";
import { connectCommand } from "./commands/connect.js";
import { saveConfig } from "./config.js";
import { createMcpProxyRuntime } from "./mcp-proxy.js";
import { buildRelayWsUrl, connectTunnel } from "./tunnel.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function createDb() {
  const client = new PGlite();
  cleanups.push(() => client.close());
  const db = drizzle(client, { schema });
  const here = dirname(fileURLToPath(import.meta.url));
  await migrate(db, {
    migrationsFolder: join(here, "../../board/drizzle"),
  });
  return db as unknown as Parameters<typeof startBoardServer>[0]["db"];
}

describe("adapter connect", () => {
  it("connects, receives session.start, proxies get_briefing", async () => {
    const db = await createDb();
    const server = await startBoardServer({ db, port: 0 });
    cleanups.push(() => server.close());
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const registered = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "claude-code",
    });

    const received: Tick[] = [];
    const adapter = await startLocalA2aServer({
      agentId: registered.agent.id,
      relayBaseUrl: server.baseUrl,
      onTick: (tick) => received.push(tick),
    });
    cleanups.push(() => adapter.close());
    const tunnel = await connectTunnel({
      relayWsUrl: buildRelayWsUrl(
        server.baseUrl,
        registered.agent.id,
        registered.agentToken,
      ),
      localBaseUrl: adapter.localBaseUrl,
    });
    cleanups.push(() => tunnel.disconnect());

    const sent = await server.sendTick({
      participantId: registered.agent.id,
      type: "session.start",
    });
    await vi.waitFor(() =>
      expect(received.map((t) => t.id)).toContain(sent.tickId),
    );

    const proxy = createMcpProxyRuntime({
      boardUrl: server.baseUrl,
      agentToken: registered.agentToken,
    });
    const briefing = JSON.parse(
      (await proxy.callTool("get_briefing", {})).content[0]!.text,
    );
    expect(briefing.remaining_budget).toEqual(expect.any(Number));

    const cardRes = await fetch(
      `${server.baseUrl}/agents/${registered.agent.id}/.well-known/agent-card.json`,
    );
    expect(cardRes.ok).toBe(true);
    const card = (await cardRes.json()) as {
      supportedInterfaces: Array<{ url: string }>;
    };
    expect(card.supportedInterfaces[0]?.url.endsWith("/")).toBe(true);

    const invalid = await proxy.callTool("set_goals", { goals: [] });
    expect(invalid.isError).toBe(true);
  });

  it("ignores a duplicate session.start for the same session", async () => {
    const db = await createDb();
    const server = await startBoardServer({ db, port: 0 });
    cleanups.push(() => server.close());
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const registered = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "claude-code",
    });

    const received: Tick[] = [];
    const adapter = await startLocalA2aServer({
      agentId: registered.agent.id,
      relayBaseUrl: server.baseUrl,
      onTick: (tick) => received.push(tick),
    });
    cleanups.push(() => adapter.close());
    const tunnel = await connectTunnel({
      relayWsUrl: buildRelayWsUrl(
        server.baseUrl,
        registered.agent.id,
        registered.agentToken,
      ),
      localBaseUrl: adapter.localBaseUrl,
    });
    cleanups.push(() => tunnel.disconnect());

    const first = await server.sendTick({
      participantId: registered.agent.id,
      type: "session.start",
    });
    await vi.waitFor(() =>
      expect(received.map((t) => t.id)).toContain(first.tickId),
    );

    const second = await server.sendTick({
      participantId: registered.agent.id,
      type: "session.start",
    });
    expect(second.status).toBe("delivered");
    expect(received.map((t) => t.id)).not.toContain(second.tickId);
    expect(received).toHaveLength(1);
  });

  it("connectCommand accumulates received ticks", async () => {
    const db = await createDb();
    const server = await startBoardServer({ db, port: 0 });
    cleanups.push(() => server.close());
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const registered = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "claude-code",
    });

    const configDir = await mkdtemp(join(tmpdir(), "comitia-connect-"));
    cleanups.push(() => rm(configDir, { recursive: true }));
    await saveConfig(configDir, {
      boardUrl: server.baseUrl,
      agents: {
        mika: {
          agentId: registered.agent.id,
          token: registered.agentToken,
          engine: "claude-code",
        },
      },
    });

    const handle = await connectCommand({ name: "mika", configDir });
    cleanups.push(() => handle.close());

    const sent = await server.sendTick({
      participantId: registered.agent.id,
      type: "session.start",
    });
    await vi.waitFor(() =>
      expect(handle.ticks.map((t) => t.id)).toContain(sent.tickId),
    );
  });

  it("replies pong to a tunnel ping", async () => {
    const wss = new WebSocketServer({ port: 0 });
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          wss.close((err) => (err ? reject(err) : resolve()));
        }),
    );
    const connected = new Promise<import("ws").WebSocket>((resolve) => {
      wss.on("connection", (socket) => resolve(socket));
    });
    const addr = wss.address();
    if (!addr || typeof addr === "string") {
      throw new Error("ping test websocket address is unavailable");
    }

    const tunnel = await connectTunnel({
      relayWsUrl: `ws://127.0.0.1:${addr.port}`,
      localBaseUrl: "http://127.0.0.1:1",
    });
    cleanups.push(() => tunnel.disconnect());

    const socket = await connected;
    const pong = new Promise<unknown>((resolve) => {
      socket.once("message", (data) => {
        resolve(JSON.parse(String(data)));
      });
    });
    socket.send(JSON.stringify({ type: "ping" }));
    await expect(pong).resolves.toEqual({ type: "pong" });
  });
});

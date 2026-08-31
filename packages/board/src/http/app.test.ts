import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { agentConnections, sessions, ticks } from "../db/schema.js";
import { prepareSessionStart } from "../domain/sessions.js";
import type { TickType } from "@comitia/shared";
import { TRACE_CHUNK_MAX_BYTES } from "@comitia/shared";
import { createBoardApp, type BoardGateway } from "./app.js";
import { startBoardServer } from "./server.js";

async function bootstrapOwnerAndAgent(app: ReturnType<typeof createBoardApp>) {
  const initRes = await app.request("/v1/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerDisplayName: "ハル",
      projectName: "comitia",
    }),
  });
  expect(initRes.status).toBe(201);
  const initBody = (await initRes.json()) as {
    ownerId: string;
    projectId: string;
    ownerToken: string;
  };

  const regRes = await app.request("/v1/agents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${initBody.ownerToken}`,
    },
    body: JSON.stringify({
      displayName: "ミカ",
      engine: "claude-code",
    }),
  });
  expect(regRes.status).toBe(201);
  const agentBody = (await regRes.json()) as {
    agentId: string;
    projectId: string;
    agentToken: string;
  };

  return { initBody, agentBody };
}

describe("board HTTP", () => {
  it("accepts optional repoUrl on init", async () => {
    const app = createBoardApp({ db });
    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
        repoUrl: "https://github.com/hskksk/comitia",
      }),
    });
    expect(initRes.status).toBe(201);
  });

  it("lets an agent read its own project's repoUrl via GET /v1/me/project", async () => {
    const app = createBoardApp({ db });
    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
        repoUrl: "https://github.com/hskksk/comitia",
      }),
    });
    const initBody = (await initRes.json()) as { ownerToken: string };

    const regRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${initBody.ownerToken}`,
      },
      body: JSON.stringify({ displayName: "ミカ", engine: "claude-code" }),
    });
    const agentBody = (await regRes.json()) as { agentToken: string };

    const projectRes = await app.request("/v1/me/project", {
      headers: { authorization: `Bearer ${agentBody.agentToken}` },
    });
    expect(projectRes.status).toBe(200);
    expect(await projectRes.json()).toEqual({
      repoUrl: "https://github.com/hskksk/comitia",
      githubOwner: null,
      githubRepo: null,
    });
  });

  it("lets an agent read identity via GET /v1/me", async () => {
    const app = createBoardApp({ db });
    const { agentBody } = await bootstrapOwnerAndAgent(app);
    const me = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${agentBody.agentToken}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      participant: { kind: "agent", displayName: "ミカ" },
      label: "ミカ@ハル",
      owner: { displayName: "ハル" },
      project: { name: "comitia" },
      projects: [expect.objectContaining({ name: "comitia" })],
    });
  });

  it("returns null repoUrl fields for a repo-less project", async () => {
    const app = createBoardApp({ db });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    const projectRes = await app.request("/v1/me/project", {
      headers: { authorization: `Bearer ${agentBody.agentToken}` },
    });
    expect(projectRes.status).toBe(200);
    expect(await projectRes.json()).toEqual({
      repoUrl: null,
      githubOwner: null,
      githubRepo: null,
    });
  });

  it("rejects GET /v1/me/project without a token", async () => {
    const app = createBoardApp({ db });
    const res = await app.request("/v1/me/project");
    expect(res.status).toBe(401);
  });

  it("rejects GET /v1/me/project for an owner token (agent-only route)", async () => {
    const app = createBoardApp({ db });
    const { initBody } = await bootstrapOwnerAndAgent(app);
    const res = await app.request("/v1/me/project", {
      headers: { authorization: `Bearer ${initBody.ownerToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("init → register → get_briefing over REST", async () => {
    const app = createBoardApp({ db });

    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    expect(initRes.status).toBe(201);
    const initBody = await initRes.json();
    const ownerToken = initBody.ownerToken as string;

    const regRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        displayName: "ミカ",
        engine: "claude-code",
      }),
    });
    expect(regRes.status).toBe(201);
    const agentToken = (await regRes.json()).agentToken as string;

    const toolRes = await app.request("/v1/tools/get_briefing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentToken}`,
      },
      body: "{}",
    });
    expect(toolRes.status).toBe(200);
    const briefing = await toolRes.json();
    expect(typeof briefing.remaining_budget).toBe("number");
  });

  it("registers a fake walkthrough engine", async () => {
    const app = createBoardApp({ db });
    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    expect(initRes.status).toBe(201);
    const ownerToken = ((await initRes.json()) as { ownerToken: string })
      .ownerToken;

    const regRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        displayName: "ウォーカー",
        engine: "fake",
      }),
    });
    expect(regRes.status).toBe(201);
  });

  it("accepts an optional role on registration", async () => {
    const app = createBoardApp({ db });
    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    const ownerToken = ((await initRes.json()) as { ownerToken: string })
      .ownerToken;

    const regRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        displayName: "walker",
        engine: "claude-code",
        role: "proposer",
      }),
    });
    expect(regRes.status).toBe(201);
  });

  it("rejects an unknown role on registration", async () => {
    const app = createBoardApp({ db });
    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    const ownerToken = ((await initRes.json()) as { ownerToken: string })
      .ownerToken;

    const regRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        displayName: "walker",
        engine: "claude-code",
        role: "captain",
      }),
    });
    expect(regRes.status).toBe(400);
  });

  it("rejects tool calls without a token", async () => {
    const app = createBoardApp({ db });
    const res = await app.request("/v1/tools/get_briefing", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("returns healthz without auth", async () => {
    const app = createBoardApp({ db });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("sends a tick through the injected gateway", async () => {
    const calls: Array<{ participantId: string; type: TickType }> = [];
    const fake: BoardGateway = {
      sendTick: async (input) => {
        calls.push(input);
        return {
          tickId: "tick-from-fake",
          sessionId: "sess-from-fake",
          status: "queued",
        };
      },
    };
    const app = createBoardApp({
      db,
      getGateway: () => fake,
    });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request("/v1/me/request-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessionId: "sess-from-fake",
      tickId: "tick-from-fake",
      status: "queued",
    });
    expect(calls).toEqual([
      { participantId: agentBody.agentId, type: "session.start" },
    ]);
  });

  it("returns 503 when gateway is missing", async () => {
    const app = createBoardApp({ db });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request("/v1/me/request-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "tick gateway is unavailable" });
  });

  it("returns 503 when getGateway returns undefined", async () => {
    const app = createBoardApp({ db, getGateway: () => undefined });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request("/v1/me/request-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "tick gateway is unavailable" });
  });

  it("owner can wake an agent via POST /v1/agents/:id/request-session", async () => {
    const calls: Array<{ participantId: string; type: TickType }> = [];
    const fake: BoardGateway = {
      sendTick: async (input) => {
        calls.push(input);
        return {
          tickId: "tick-owner-wake",
          sessionId: "sess-owner-wake",
          status: "delivered",
        };
      },
    };
    const app = createBoardApp({
      db,
      getGateway: () => fake,
    });
    const { initBody, agentBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request(
      `/v1/agents/${agentBody.agentId}/request-session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${initBody.ownerToken}`,
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessionId: "sess-owner-wake",
      tickId: "tick-owner-wake",
      status: "delivered",
    });
    expect(calls).toEqual([
      { participantId: agentBody.agentId, type: "session.start" },
    ]);
  });

  it("rejects agent token on POST /v1/agents/:id/request-session", async () => {
    const app = createBoardApp({
      db,
      getGateway: () => ({
        sendTick: async () => ({
          tickId: "tick",
          sessionId: "sess",
          status: "queued",
        }),
      }),
    });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request(
      `/v1/agents/${agentBody.agentId}/request-session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agentBody.agentToken}`,
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "human required" });
  });

  it("returns 404 for unknown agent on POST /v1/agents/:id/request-session", async () => {
    const app = createBoardApp({
      db,
      getGateway: () => ({
        sendTick: async () => ({
          tickId: "tick",
          sessionId: "sess",
          status: "queued",
        }),
      }),
    });
    const { initBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request(
      "/v1/agents/00000000-0000-0000-0000-000000000000/request-session",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${initBody.ownerToken}`,
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "エージェントが見つかりません" });
  });

  it(
    "POST /v1/me/request-session over HTTP calls sendTick",
    async () => {
      const server = await startBoardServer({ db, port: 0 });
      try {
        const initRes = await fetch(`${server.baseUrl}/v1/init`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ownerDisplayName: "ハル",
            projectName: "comitia",
          }),
        });
        expect(initRes.status).toBe(201);
        const initBody = (await initRes.json()) as { ownerToken: string };

        const regRes = await fetch(`${server.baseUrl}/v1/agents`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${initBody.ownerToken}`,
          },
          body: JSON.stringify({
            displayName: "ミカ",
            engine: "claude-code",
          }),
        });
        expect(regRes.status).toBe(201);
        const agentBody = (await regRes.json()) as {
          agentId: string;
          agentToken: string;
        };

        const res = await fetch(`${server.baseUrl}/v1/me/request-session`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${agentBody.agentToken}`,
          },
          body: "{}",
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          sessionId: string;
          tickId: string;
          status: "delivered" | "queued";
        };
        expect(body.tickId).toBeTruthy();
        expect(body.sessionId).toBeTruthy();
        expect(body.status).toBe("queued");

        const [row] = await db
          .select()
          .from(ticks)
          .where(eq(ticks.id, body.tickId));
        expect(row?.type).toBe("session.start");
        expect(row?.status).toBe("queued");
        expect(row?.participantId).toBe(agentBody.agentId);
      } finally {
        await server.close();
      }
    },
    30_000,
  );

  it("appends chat log and token usage on the agent's own session", async () => {
    const app = createBoardApp({ db });
    const { initBody, agentBody } = await bootstrapOwnerAndAgent(app);

    const session = await prepareSessionStart(db, {
      participantId: agentBody.agentId,
      projectId: agentBody.projectId,
    });
    const sessionId = session.id;

    const chatRes = await app.request(`/v1/sessions/${sessionId}/chat-log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ chunk: "hello " }),
    });
    expect(chatRes.status).toBe(200);
    expect(await chatRes.json()).toEqual({ ok: true });

    const chatRes2 = await app.request(`/v1/sessions/${sessionId}/chat-log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ chunk: "world" }),
    });
    expect(chatRes2.status).toBe(200);

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(row?.chatLog).toBe("hello \nworld\n");

    const oversized = "x".repeat(TRACE_CHUNK_MAX_BYTES);
    const tooLarge = await app.request(`/v1/sessions/${sessionId}/chat-log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ chunk: oversized + "y" }),
    });
    expect(tooLarge.status).toBe(413);

    const traceRes = await app.request(`/v1/sessions/${sessionId}/trace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({
        entries: [
          {
            v: 1,
            seq: 1,
            at: "2026-08-31T12:00:00.000Z",
            kind: "tool_call",
            run: 1,
            tool: "get_briefing",
            args: {},
          },
        ],
      }),
    });
    expect(traceRes.status).toBe(200);
    expect(await traceRes.json()).toEqual({ ok: true, lastSeq: 1 });

    const otherAgentRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${initBody.ownerToken}`,
      },
      body: JSON.stringify({
        displayName: "コト",
        engine: "claude-code",
      }),
    });
    expect(otherAgentRes.status).toBe(201);
    const otherAgent = (await otherAgentRes.json()) as { agentToken: string };

    const deniedTrace = await app.request(`/v1/sessions/${sessionId}/trace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${otherAgent.agentToken}`,
      },
      body: JSON.stringify({
        entries: [
          {
            v: 1,
            at: "2026-08-31T12:00:01.000Z",
            kind: "tool_call",
            run: 1,
            tool: "get_briefing",
            args: {},
          },
        ],
      }),
    });
    expect(deniedTrace.status).toBe(400);
    expect(await deniedTrace.json()).toEqual({
      error: "セッションの所有者ではありません",
    });

    const usageRes = await app.request(`/v1/sessions/${sessionId}/token-usage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ tokens: 7 }),
    });
    expect(usageRes.status).toBe(200);
    const usage = (await usageRes.json()) as { remaining_budget: number };
    expect(typeof usage.remaining_budget).toBe("number");
    expect(usage.remaining_budget).toBe((row?.budgetLimit ?? 0) - 7);
  });

  it("returns 404 for unknown tools", async () => {
    const app = createBoardApp({ db });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request("/v1/tools/not_a_tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("returns connection status for the owner", async () => {
    const app = createBoardApp({ db });
    const { initBody, agentBody } = await bootstrapOwnerAndAgent(app);

    const res = await app.request(`/v1/agents/${agentBody.agentId}/connection`, {
      headers: {
        authorization: `Bearer ${initBody.ownerToken}`,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      lastSeenAt: string | null;
    };
    expect(body.status).toBe("disconnected");
    expect(body.lastSeenAt).toBeNull();
  });

  it("sends session.end_warning after a tool leaves remaining at the wind-down reserve", async () => {
    const calls: Array<{ participantId: string; type: TickType }> = [];
    const fake: BoardGateway = {
      sendTick: async (input) => {
        calls.push(input);
        return {
          tickId: `tick-${calls.length}`,
          sessionId: "sess-end-warning",
          status: "queued",
        };
      },
    };
    const app = createBoardApp({
      db,
      getGateway: () => fake,
    });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    await db
      .update(agentConnections)
      .set({ status: "connected", lastSeenAt: new Date() })
      .where(eq(agentConnections.participantId, agentBody.agentId));

    const briefingRes = await app.request("/v1/tools/get_briefing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    expect(briefingRes.status).toBe(200);

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.participantId, agentBody.agentId));
    expect(session).toBeTruthy();
    await db
      .update(sessions)
      .set({
        budgetUsed: session!.budgetLimit - session!.windDownReserved - 5,
      })
      .where(eq(sessions.id, session!.id));

    const goalsRes = await app.request("/v1/tools/set_goals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ goals: ["wrap up"] }),
    });
    expect(goalsRes.status).toBe(200);
    expect(calls).toEqual([
      { participantId: agentBody.agentId, type: "session.end_warning" },
    ]);
  });

  it("sends session.end_warning after token usage reaches the wind-down reserve", async () => {
    const calls: Array<{ participantId: string; type: TickType }> = [];
    const fake: BoardGateway = {
      sendTick: async (input) => {
        calls.push(input);
        return {
          tickId: `tick-${calls.length}`,
          sessionId: "sess-token-end-warning",
          status: "queued",
        };
      },
    };
    const app = createBoardApp({
      db,
      getGateway: () => fake,
    });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    await db
      .update(agentConnections)
      .set({ status: "connected", lastSeenAt: new Date() })
      .where(eq(agentConnections.participantId, agentBody.agentId));

    const briefingRes = await app.request("/v1/tools/get_briefing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    expect(briefingRes.status).toBe(200);

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.participantId, agentBody.agentId));
    expect(session).toBeTruthy();

    await db
      .update(sessions)
      .set({
        budgetUsed: session!.budgetLimit - session!.windDownReserved - 3,
      })
      .where(eq(sessions.id, session!.id));

    const usageRes = await app.request(
      `/v1/sessions/${session!.id}/token-usage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agentBody.agentToken}`,
        },
        body: JSON.stringify({ tokens: 500 }),
      },
    );
    expect(usageRes.status).toBe(200);
    expect(calls).toEqual([
      { participantId: agentBody.agentId, type: "session.end_warning" },
    ]);
  });

  it("does not send session.end_warning when one is already queued for the session", async () => {
    const calls: Array<{ participantId: string; type: TickType }> = [];
    const fake: BoardGateway = {
      sendTick: async (input) => {
        calls.push(input);
        return {
          tickId: `tick-${calls.length}`,
          sessionId: "sess-end-warning",
          status: "queued",
        };
      },
    };
    const app = createBoardApp({
      db,
      getGateway: () => fake,
    });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    await db
      .update(agentConnections)
      .set({ status: "connected", lastSeenAt: new Date() })
      .where(eq(agentConnections.participantId, agentBody.agentId));

    const briefingRes = await app.request("/v1/tools/get_briefing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    expect(briefingRes.status).toBe(200);

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.participantId, agentBody.agentId));
    expect(session).toBeTruthy();

    await db.insert(ticks).values({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      participantId: agentBody.agentId,
      sessionId: session!.id,
      type: "session.end_warning",
      status: "queued",
      sequence: 1,
    });

    await db
      .update(sessions)
      .set({
        budgetUsed: session!.budgetLimit - session!.windDownReserved - 5,
      })
      .where(eq(sessions.id, session!.id));

    const goalsRes = await app.request("/v1/tools/set_goals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: JSON.stringify({ goals: ["wrap up"] }),
    });
    expect(goalsRes.status).toBe(200);
    expect(calls).toEqual([]);
  });
});

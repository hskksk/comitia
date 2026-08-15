import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { sessions } from "../db/schema.js";
import { createBoardApp } from "./app.js";

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

  it("prepares a session without sending a tick", async () => {
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
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      tickId: string | null;
      status: string;
    };
    expect(body.sessionId).toBeTruthy();
    expect(body.tickId).toBeNull();
    expect(body.status).toBe("prepared");
  });

  it("appends chat log and token usage on the agent's own session", async () => {
    const app = createBoardApp({ db });
    const { agentBody } = await bootstrapOwnerAndAgent(app);

    const prepared = await app.request("/v1/me/request-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentBody.agentToken}`,
      },
      body: "{}",
    });
    const { sessionId } = (await prepared.json()) as { sessionId: string };

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
    expect(row?.chatLog).toBe("hello world");

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
});

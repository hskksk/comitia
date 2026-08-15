import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { createBoardApp } from "./app.js";
import {
  seedAwaitingRatification,
  seedDecidedImplementation,
  seedOwnerAgentProject,
} from "../test/human-fixtures.js";
import { hashToken, issueToken } from "../domain/credentials.js";
import { agentCredentials } from "../db/schema.js";

async function ownerAuthHeader(ownerId: string, projectId: string) {
  const token = issueToken();
  await db.insert(agentCredentials).values({
    participantId: ownerId,
    projectId,
    tokenHash: hashToken(token),
  });
  return { authorization: `Bearer ${token}` };
}

describe("human REST", () => {
  it("returns the judgment queue for the owner token", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const seeded = await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
      synthesis: "争点",
    });
    const headers = await ownerAuthHeader(owner.id, project.id);

    const me = await app.request("/v1/me", { headers });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      participant: { id: owner.id, kind: "human", displayName: "ハル" },
      projectId: project.id,
    });

    const queue = await app.request("/v1/queue", { headers });
    expect(queue.status).toBe(200);
    const body = (await queue.json()) as { items: Array<{ threadId: string }> };
    expect(body.items[0]?.threadId).toBe(seeded.thread.id);
  });

  it("ratifies from POST /v1/threads/:id/declare without spending budget", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const seeded = await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
    });
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const res = await app.request(`/v1/threads/${seeded.thread.id}/declare`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "ratify",
        binding: true,
        summary: "批准する",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { state: string };
      remaining_budget?: number;
    };
    expect(body.thread.state).toBe("decided");
    expect(body.remaining_budget).toBeUndefined();
  });

  it("rejects agent-only declaration kinds from the human route", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const seeded = await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
    });
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const res = await app.request(`/v1/threads/${seeded.thread.id}/declare`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "select_candidate",
        proposalVersionId: seeded.version.id,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("forbids the agent token on human routes", async () => {
    const app = createBoardApp({ db });
    const init = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    const { ownerToken } = (await init.json()) as { ownerToken: string };
    const reg = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ displayName: "ミカ", engine: "claude-code" }),
    });
    const { agentToken } = (await reg.json()) as { agentToken: string };

    const res = await app.request("/v1/queue", {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("lists the nonblocking inbox and completes a thread", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const seeded = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const inbox = await app.request("/v1/inbox", { headers });
    expect(inbox.status).toBe(200);
    const listed = (await inbox.json()) as { items: Array<{ threadId: string }> };
    expect(listed.items[0]?.threadId).toBe(seeded.thread.id);

    const done = await app.request(`/v1/threads/${seeded.thread.id}/declare`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "complete_thread" }),
    });
    expect(done.status).toBe(200);
    expect((await done.json()).thread.state).toBe("completed");
  });
});

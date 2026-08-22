import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { PROJECT_ID_HEADER } from "@comitia/shared";
import { db } from "../test/helpers.js";
import { createBoardApp } from "./app.js";
import { createThread } from "../domain/threads.js";
import { addProposal } from "../domain/proposals.js";
import { declare } from "../domain/declare.js";
import {
  seedOwnerAgentProject,
  seedAwaitingRatification,
} from "../test/human-fixtures.js";
import { hashToken, issueToken } from "../domain/credentials.js";
import { agentCredentials } from "../db/schema.js";

async function humanAuth(participantId: string, projectId?: string | null) {
  const token = issueToken();
  await db.insert(agentCredentials).values({
    participantId,
    projectId: projectId ?? null,
    tokenHash: hashToken(token),
  });
  return token;
}

describe("M13-1 accounts and membership", () => {
  it("lets a second GitHub-less human register and join by invite", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const ownerToken = await humanAuth(owner.id, project.id);
    const ownerHeaders = {
      authorization: `Bearer ${ownerToken}`,
      "content-type": "application/json",
    };

    const register = await app.request("/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "ユウ" }),
    });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as {
      participantId: string;
      token: string;
    };

    const invite = await app.request(`/v1/projects/${project.id}/invites`, {
      method: "POST",
      headers: ownerHeaders,
    });
    expect(invite.status).toBe(201);
    const { token: inviteToken } = (await invite.json()) as { token: string };

    const join = await app.request("/v1/join", {
      method: "POST",
      headers: {
        authorization: `Bearer ${registered.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: inviteToken }),
    });
    expect(join.status).toBe(200);

    const memberHeaders = {
      authorization: `Bearer ${registered.token}`,
      "content-type": "application/json",
      [PROJECT_ID_HEADER]: project.id,
    };
    const created = await app.request("/v1/threads", {
      method: "POST",
      headers: memberHeaders,
      body: JSON.stringify({
        title: "メンバー起票",
        type: "consultation",
        trigger: "試し",
        duplicateSearchQuery: "member thread",
        conflictCitationsChecked: true,
      }),
    });
    expect(created.status).toBe(201);

    const patched = await app.request(`/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: memberHeaders,
      body: JSON.stringify({ name: "乗っ取られた" }),
    });
    expect(patched.status).toBe(403);
  });

  it("separates queues across two projects via the project header", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const token = await humanAuth(owner.id, null);
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const second = await app.request("/v1/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "実験場" }),
    });
    expect(second.status).toBe(201);
    const other = (await second.json()) as { id: string };

    await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
      title: "本線の判断",
    });

    const queueA = await app.request("/v1/queue", {
      headers: { ...headers, [PROJECT_ID_HEADER]: project.id },
    });
    const queueB = await app.request("/v1/queue", {
      headers: { ...headers, [PROJECT_ID_HEADER]: other.id },
    });
    expect(queueA.status).toBe(200);
    expect(queueB.status).toBe(200);
    const aItems = (await queueA.json()) as { items: Array<{ title: string }> };
    const bItems = (await queueB.json()) as { items: Array<{ title: string }> };
    expect(aItems.items.some((item) => item.title === "本線の判断")).toBe(true);
    expect(bItems.items).toEqual([]);
  });

  it("refuses to archive a thread with an active binding agreement", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const token = await humanAuth(owner.id, project.id);
    const headers = { authorization: `Bearer ${token}` };

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "implementation",
      title: "拘束合意",
      trigger: "rule",
      duplicateSearchQuery: "binding",
      consensusType: "owner_decision",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "拘束する",
    });
    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });
    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "owner_decide",
      payload: { binding: true, summary: "拘束合意を採用" },
    });

    const blocked = await app.request(`/v1/threads/${thread.id}`, {
      method: "DELETE",
      headers,
    });
    expect(blocked.status).toBe(400);

    const empty = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "consultation",
      title: "試し起票",
      trigger: "試す",
      duplicateSearchQuery: "scratch",
      conflictCitationsChecked: true,
    });
    const deleted = await app.request(`/v1/threads/${empty.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(204);
    const listed = await app.request("/v1/threads", { headers });
    const body = (await listed.json()) as { items: Array<{ id: string }> };
    expect(body.items.some((item) => item.id === empty.id)).toBe(false);
  });

  it("cannot wake an agent from another project", async () => {
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
    const init = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    const { ownerToken } = (await init.json()) as { ownerToken: string };
    const agentRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ displayName: "ミカ", engine: "claude-code" }),
    });
    const { agentId } = (await agentRes.json()) as { agentId: string };
    const other = await app.request("/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ name: "別場" }),
    });
    const { id: otherId } = (await other.json()) as { id: string };
    const wake = await app.request(`/v1/agents/${agentId}/request-session`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        [PROJECT_ID_HEADER]: otherId,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(wake.status).toBe(404);
  });

  it("lists and revokes identity credentials for the current human", async () => {
    const app = createBoardApp({ db });
    const { owner } = await seedOwnerAgentProject(db);
    const ownerToken = await humanAuth(owner.id, null);
    const headers = { authorization: `Bearer ${ownerToken}` };

    const listed = await app.request("/v1/me/credentials", { headers });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      items: Array<{ id: string; clientLabel: string; current: boolean }>;
    };
    expect(body.items.length).toBeGreaterThan(0);

    const target = body.items.find((item) => !item.current) ?? body.items[0]!;
    const revoked = await app.request(`/v1/me/credentials/${target.id}`, {
      method: "DELETE",
      headers,
    });
    expect(revoked.status).toBe(200);
    const revokedBody = (await revoked.json()) as { current: boolean };
    expect(revokedBody.current).toBe(target.current);
  });
});

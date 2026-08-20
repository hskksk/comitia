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
import { agentCredentials, memories, sessions, ticks } from "../db/schema.js";
import { createThread } from "../domain/threads.js";
import { addProposal } from "../domain/proposals.js";
import { openOrGetSession } from "../domain/sessions.js";
import { registerParticipant } from "../domain/participants.js";
import { addMembership } from "../domain/memberships.js";
import { eq } from "drizzle-orm";

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

  it("lets the human thread owner select a candidate", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      target: "shared_artifact",
      sharedArtifactKind: "project_rule",
      title: "区分を導入する",
      trigger: "憲法層の矛盾",
      duplicateSearchQuery: "区分 ルール",
      consensusType: "human_ratification",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: owner.id,
      content: "区分を導入する",
    });
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const res = await app.request(`/v1/threads/${thread.id}/declare`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "select_candidate",
        proposalVersionId: version.id,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thread: { candidateProposalVersionId: string | null } };
    expect(body.thread.candidateProposalVersionId).toBe(version.id);
  });

  it("rejects unknown declaration kinds from the human route", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const res = await app.request("/v1/threads/00000000-0000-4000-8000-000000000001/declare", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "unknown_kind" }),
    });
    expect(res.status).toBe(400);
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

  it("creates a proposal thread, proposal, and post from human REST", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const created = await app.request("/v1/threads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "区分を導入する",
        type: "proposal",
        trigger: "憲法層の矛盾",
        duplicateSearchQuery: "区分 ルール",
        conflictCitationsChecked: true,
        consensusType: "human_ratification",
        target: "shared_artifact",
        sharedArtifactKind: "project_rule",
      }),
    });
    expect(created.status).toBe(201);
    const thread = (await created.json()) as { id: string; state: string };
    expect(thread.state).toBe("discussing");

    const search = await app.request("/v1/search/threads?q=区分", { headers });
    expect(search.status).toBe(200);
    const found = (await search.json()) as { items: Array<{ id: string }> };
    expect(found.items.some((item) => item.id === thread.id)).toBe(true);

    const proposal = await app.request(`/v1/threads/${thread.id}/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "区分を導入する" }),
    });
    expect(proposal.status).toBe(201);

    const post = await app.request(`/v1/threads/${thread.id}/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "comment", body: "論点を整理する" }),
    });
    expect(post.status).toBe(201);
    expect((await post.json() as { remaining_budget?: number }).remaining_budget).toBeUndefined();

    const view = await app.request(`/v1/threads/${thread.id}`, { headers });
    const body = (await view.json()) as {
      proposals: Array<{ content: string }>;
      posts: Array<{ type: string; body: string }>;
    };
    expect(body.proposals[0]?.content).toBe("区分を導入する");
    expect(body.posts.some((item) => item.body === "論点を整理する")).toBe(true);
  });

  it("creates an implementation thread and accepts a report", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const created = await app.request("/v1/threads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "typo 修正",
        type: "implementation",
        trigger: "表記ゆれ",
        duplicateSearchQuery: "typo",
        conflictCitationsChecked: true,
        consensusType: "owner_decision",
      }),
    });
    expect(created.status).toBe(201);
    const thread = (await created.json()) as { id: string };

    const report = await app.request(`/v1/threads/${thread.id}/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "report", body: "直した" }),
    });
    expect(report.status).toBe(201);
  });

  it("rejects objection without rationale and declaration-typed posts", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      target: "shared_artifact",
      sharedArtifactKind: "project_rule",
      title: "案",
      trigger: "きっかけ",
      duplicateSearchQuery: "案",
      consensusType: "human_ratification",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: owner.id,
      content: "本文",
    });
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const objection = await app.request(`/v1/threads/${thread.id}/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "objection",
        body: "反対",
        proposalVersionId: version.id,
        blocking: true,
      }),
    });
    expect(objection.status).toBe(400);

    const declaration = await app.request(`/v1/threads/${thread.id}/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "declaration", body: "宣言" }),
    });
    expect(declaration.status).toBe(400);
  });

  it("claims and releases work on a thread via REST", async () => {
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

    const claimed = await app.request(
      `/v1/threads/${seeded.thread.id}/work-claims`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ paths: ["docs/"] }),
      },
    );
    expect(claimed.status).toBe(201);
    const claim = (await claimed.json()) as { id: string; paths: string[] };
    expect(claim.paths).toEqual(["docs/"]);

    const view = await app.request(`/v1/threads/${seeded.thread.id}`, {
      headers,
    });
    const viewBody = (await view.json()) as {
      workClaims: Array<{ id: string; paths: string[] }>;
    };
    expect(viewBody.workClaims.some((row) => row.id === claim.id)).toBe(true);

    const released = await app.request(
      `/v1/threads/${seeded.thread.id}/work-claims/${claim.id}/release`,
      { method: "POST", headers },
    );
    expect(released.status).toBe(200);
    expect((await released.json()) as { active: boolean }).toMatchObject({
      active: false,
    });
  });

  it("rejects releasing another participant's claim", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const seeded = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const ownerHeaders = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const claimed = await app.request(
      `/v1/threads/${seeded.thread.id}/work-claims`,
      {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ paths: ["docs/"] }),
      },
    );
    const claim = (await claimed.json()) as { id: string };

    const other = await registerParticipant(db, {
      kind: "human",
      displayName: "別の人",
    });
    await addMembership(db, {
      projectId: project.id,
      participantId: other.id,
      actorId: owner.id,
    });
    const otherHeaders = await ownerAuthHeader(other.id, project.id);

    const released = await app.request(
      `/v1/threads/${seeded.thread.id}/work-claims/${claim.id}/release`,
      { method: "POST", headers: otherHeaders },
    );
    expect(released.status).toBe(400);
  });

  it("rejects releasing a claim through a different thread's URL", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const seeded = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "対象スレッド",
    });
    const otherThread = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
      title: "別スレッド",
    });
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const claimed = await app.request(
      `/v1/threads/${seeded.thread.id}/work-claims`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ paths: ["docs/"] }),
      },
    );
    const claim = (await claimed.json()) as { id: string };

    const released = await app.request(
      `/v1/threads/${otherThread.thread.id}/work-claims/${claim.id}/release`,
      { method: "POST", headers },
    );
    expect(released.status).toBe(400);
  });
});

describe("notes and memory REST", () => {
  it("writes and reads back the owner's own memory", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const before = await app.request("/v1/memory", { headers });
    expect(((await before.json()) as { items: unknown[] }).items).toHaveLength(0);

    await db
      .insert(memories)
      .values({ participantId: owner.id, body: "気づき" });

    const after = await app.request("/v1/memory", { headers });
    const body = (await after.json()) as { items: Array<{ body: string }> };
    expect(body.items.some((item) => item.body === "気づき")).toBe(true);
  });

  it("creates a public note, searches it, and comments on it", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const created = await app.request("/v1/notes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "公開メモ",
        body: "本文",
        format: "journal",
      }),
    });
    expect(created.status).toBe(201);
    const note = (await created.json()) as { id: string };

    const search = await app.request("/v1/notes", { headers });
    const searched = (await search.json()) as { items: Array<{ id: string }> };
    expect(searched.items.some((item) => item.id === note.id)).toBe(true);

    const comment = await app.request(`/v1/notes/${note.id}/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: "助言" }),
    });
    expect(comment.status).toBe(201);
  });

  it("returns 403 when a different participant reads or comments on a private note", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const created = await app.request("/v1/notes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "非公開メモ",
        body: "本文",
        format: "journal",
        visibility: "private",
      }),
    });
    const note = (await created.json()) as { id: string };

    const other = await registerParticipant(db, {
      kind: "human",
      displayName: "別の人",
    });
    const otherHeaders = {
      ...(await ownerAuthHeader(other.id, project.id)),
      "content-type": "application/json",
    };

    const read = await app.request(`/v1/notes/${note.id}`, {
      headers: otherHeaders,
    });
    expect(read.status).toBe(403);

    const comment = await app.request(`/v1/notes/${note.id}/comments`, {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({ body: "覗き見コメント" }),
    });
    expect(comment.status).toBe(403);
  });
});

describe("human ops REST", () => {
  it("lists project, participants, agreements, and events", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    await seedAwaitingRatification(db, {
      ownerId: owner.id,
      agentId: agent.id,
      projectId: project.id,
    });
    const headers = await ownerAuthHeader(owner.id, project.id);

    const projectRes = await app.request("/v1/project", { headers });
    expect(projectRes.status).toBe(200);
    const summary = (await projectRes.json()) as {
      name: string;
      queueCount: number;
    };
    expect(summary.name).toBe("comitia");
    expect(summary.queueCount).toBe(1);

    const people = await app.request("/v1/participants", { headers });
    expect(people.status).toBe(200);
    const listed = (await people.json()) as {
      items: Array<{ displayName: string; kind: string; connection: unknown }>;
    };
    expect(listed.items.some((item) => item.displayName === "ハル")).toBe(true);
    expect(listed.items.some((item) => item.displayName === "ミカ" && item.kind === "agent")).toBe(
      true,
    );

    const agreements = await app.request("/v1/agreements", { headers });
    expect(agreements.status).toBe(200);

    const events = await app.request("/v1/events?limit=10", { headers });
    expect(events.status).toBe(200);
    const eventBody = (await events.json()) as { items: Array<{ kind: string }> };
    expect(eventBody.items.length).toBeGreaterThan(0);
  });

  it("derives wake status: queued tick, undigested session, idle, and digested (null)", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const queuedAgent = await registerParticipant(db, {
      kind: "agent",
      displayName: "キュー",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const undigestedAgent = await registerParticipant(db, {
      kind: "agent",
      displayName: "未消化",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const idleAgent = await registerParticipant(db, {
      kind: "agent",
      displayName: "休眠",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const digestedAgent = await registerParticipant(db, {
      kind: "agent",
      displayName: "消化済み",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });

    for (const agent of [
      queuedAgent,
      undigestedAgent,
      idleAgent,
      digestedAgent,
    ]) {
      await addMembership(db, {
        projectId: project.id,
        participantId: agent.id,
        actorId: owner.id,
      });
    }

    await db.insert(ticks).values({
      id: crypto.randomUUID(),
      participantId: queuedAgent.id,
      type: "session.start",
      status: "queued",
      sequence: 1,
    });
    await openOrGetSession(db, {
      participantId: undigestedAgent.id,
      projectId: project.id,
    });
    const digestedSession = await openOrGetSession(db, {
      participantId: digestedAgent.id,
      projectId: project.id,
    });
    await db
      .update(sessions)
      .set({ briefingAt: new Date() })
      .where(eq(sessions.id, digestedSession.id));

    const headers = await ownerAuthHeader(owner.id, project.id);
    const people = await app.request("/v1/participants", { headers });
    const listed = (await people.json()) as {
      items: Array<{ displayName: string; wake: string | null }>;
    };
    const wakeOf = (name: string) =>
      listed.items.find((item) => item.displayName === name)?.wake;
    expect(wakeOf("キュー")).toBe("queued");
    expect(wakeOf("未消化")).toBe("undigested");
    expect(wakeOf("休眠")).toBe("idle");
    expect(wakeOf("消化済み")).toBeNull();
  });

  it("lets the registering owner read chat logs and forbids others", async () => {
    const app = createBoardApp({ db });
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await db
      .update(sessions)
      .set({ chatLog: "alpha\nbeta\n" })
      .where(eq(sessions.id, session.id));

    const ownerHeaders = await ownerAuthHeader(owner.id, project.id);
    const sessionsRes = await app.request(`/v1/agents/${agent.id}/sessions`, {
      headers: ownerHeaders,
    });
    expect(sessionsRes.status).toBe(200);
    const sessionList = (await sessionsRes.json()) as {
      items: Array<{ id: string; remainingBudget: number }>;
    };
    expect(sessionList.items[0]?.id).toBe(session.id);
    expect(sessionList.items[0]?.remainingBudget).toBeGreaterThan(0);

    const open = await app.request("/v1/sessions?open=1", { headers: ownerHeaders });
    expect(open.status).toBe(200);
    expect(
      ((await open.json()) as { items: Array<{ id: string }> }).items[0]?.id,
    ).toBe(session.id);

    const log = await app.request(`/v1/sessions/${session.id}/chat-log`, {
      headers: ownerHeaders,
    });
    expect(log.status).toBe(200);
    const logBody = (await log.json()) as { chatLog: string; truncated: boolean };
    expect(logBody.chatLog).toContain("alpha");
    expect(logBody.truncated).toBe(false);

    const other = await registerParticipant(db, {
      kind: "human",
      displayName: "別の人",
    });
    const otherToken = issueToken();
    await db.insert(agentCredentials).values({
      participantId: other.id,
      projectId: project.id,
      tokenHash: hashToken(otherToken),
    });
    const denied = await app.request(`/v1/sessions/${session.id}/chat-log`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(denied.status).toBe(403);
  });

  it("forbids agent tokens from reading chat logs", async () => {
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
    const { agentId, agentToken } = (await reg.json()) as {
      agentId: string;
      agentToken: string;
    };
    const { projectId } = (await (
      await app.request("/v1/me", {
        headers: { authorization: `Bearer ${ownerToken}` },
      })
    ).json()) as { projectId: string };

    const session = await openOrGetSession(db, {
      participantId: agentId,
      projectId,
    });
    await db
      .update(sessions)
      .set({ chatLog: "secret" })
      .where(eq(sessions.id, session.id));

    const res = await app.request(`/v1/sessions/${session.id}/chat-log`, {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("sets and clears the project repo binding via PATCH /v1/project", async () => {
    const app = createBoardApp({ db });
    const { owner, project } = await seedOwnerAgentProject(db);
    const headers = {
      ...(await ownerAuthHeader(owner.id, project.id)),
      "content-type": "application/json",
    };

    const set = await app.request("/v1/project", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ repoUrl: "https://github.com/hskksk/comitia" }),
    });
    expect(set.status).toBe(200);
    const setBody = (await set.json()) as { githubOwner: string; githubRepo: string };
    expect(setBody.githubOwner).toBe("hskksk");
    expect(setBody.githubRepo).toBe("comitia");

    const summary = await app.request("/v1/project", { headers });
    expect((await summary.json()) as { repoUrl: string }).toMatchObject({
      repoUrl: "https://github.com/hskksk/comitia",
    });

    const cleared = await app.request("/v1/project", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ repoUrl: null }),
    });
    expect((await cleared.json()) as { repoUrl: string | null }).toMatchObject({
      repoUrl: null,
    });
  });

  it("forbids agent tokens from PATCHing the project", async () => {
    const app = createBoardApp({ db });
    const init = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerDisplayName: "ハル", projectName: "comitia" }),
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

    const res = await app.request("/v1/project", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ repoUrl: "https://github.com/a/b" }),
    });
    expect(res.status).toBe(403);
  });
});

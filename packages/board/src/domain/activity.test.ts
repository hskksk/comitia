import { DEFAULT_SESSION_BUDGET, WIND_DOWN_RESERVE } from "@comitia/shared";
import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { events, sessions } from "../db/schema.js";
import {
  computeRemaining,
  getRemainingBudget,
  addTokenUsage,
  refundSpend,
  spend,
} from "./activity.js";
import { openOrGetSession } from "./sessions.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";
import { addMembership } from "./memberships.js";
import { createThread } from "./threads.js";
import { createBoardMcpServer } from "../mcp/create-server.js";
import { adoptDefaultFounding } from "./founding.js";

describe("activity budget", () => {
  async function setupAgentSession() {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
    });
    const project = await createProject(db, {
      name: "comitia-web",
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    await addMembership(db, {
      projectId: project.id,
      participantId: agent.id,
      actorId: owner.id,
    });
    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    return { agent, project, session };
  }

  it("spend decreases remaining budget", async () => {
    const { session } = await setupAgentSession();
    const before = await getRemainingBudget(db, session.id);

    const after = await spend(db, session.id, "post");
    expect(after).toBe(before - 5);

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(computeRemaining(row!)).toBe(after);
  });

  it("refundSpend restores the charge for a failed mutating tool", async () => {
    const { session } = await setupAgentSession();
    const before = await getRemainingBudget(db, session.id);

    await spend(db, session.id, "create_thread");
    const restored = await refundSpend(db, session.id, "create_thread");
    expect(restored).toBe(before);
    expect(await getRemainingBudget(db, session.id)).toBe(before);
  });

  it("addTokenUsage does not consume below the wind-down reserve", async () => {
    const { session } = await setupAgentSession();

    await db
      .update(sessions)
      .set({ budgetUsed: DEFAULT_SESSION_BUDGET - WIND_DOWN_RESERVE - 3 })
      .where(eq(sessions.id, session.id));

    const remaining = await addTokenUsage(db, session.id, 500);
    expect(remaining).toBe(WIND_DOWN_RESERVE);
    expect(await getRemainingBudget(db, session.id)).toBe(WIND_DOWN_RESERVE);
  });

  it("when remaining <= reserve, post fails and end_session succeeds", async () => {
    const { agent, project, session } = await setupAgentSession();

    await db
      .update(sessions)
      .set({ budgetUsed: DEFAULT_SESSION_BUDGET - WIND_DOWN_RESERVE })
      .where(eq(sessions.id, session.id));

    expect(await getRemainingBudget(db, session.id)).toBe(10);

    const { callTool, parseJsonContent } = createBoardMcpServer({
      db,
      participantId: agent.id,
      projectId: project.id,
    });

    const postResult = await callTool("post", {
      thread_id: "00000000-0000-4000-8000-000000000001",
      type: "comment",
      body: "test",
    });
    expect(postResult.isError).toBe(true);

    const endResult = await callTool("end_session", {
      handover: "ウィンドダウン完了",
    });
    expect(endResult.isError).toBeUndefined();
    const payload = parseJsonContent(endResult);
    expect(payload.ok).toBe(true);
  });

  it("spend tags the budget_spent event with the given threadId", async () => {
    const { agent, project, session } = await setupAgentSession();
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "consultation",
      title: "検討",
      trigger: "確認",
      duplicateSearchQuery: "検討",
      conflictCitationsChecked: true,
    });

    await spend(db, session.id, "post", thread.id);

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.kind, "budget_spent"));
    const tagged = rows.find((row) => row.threadId === thread.id);
    expect(tagged).toBeTruthy();
  });

  it("tags budget_spent from read_thread with the real thread id via MCP", async () => {
    const { agent, project } = await setupAgentSession();
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "consultation",
      title: "検討",
      trigger: "確認",
      duplicateSearchQuery: "検討",
      conflictCitationsChecked: true,
    });

    const { callTool } = createBoardMcpServer({
      db,
      participantId: agent.id,
      projectId: project.id,
    });

    await callTool("read_thread", { thread_id: thread.id });

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.kind, "budget_spent"));
    const tagged = rows.find(
      (row) =>
        row.threadId === thread.id &&
        (row.payload as { toolName?: string }).toolName === "read_thread",
    );
    expect(tagged).toBeTruthy();
  });

  it("read_thread with a well-formed but nonexistent thread id still returns a clean error", async () => {
    const { agent, project } = await setupAgentSession();

    const { callTool } = createBoardMcpServer({
      db,
      participantId: agent.id,
      projectId: project.id,
    });

    const result = await callTool("read_thread", {
      thread_id: "00000000-0000-4000-8000-000000000099",
    });
    expect(result.isError).toBe(true);
  });
});

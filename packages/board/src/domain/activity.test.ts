import { DEFAULT_SESSION_BUDGET, WIND_DOWN_RESERVE } from "@comitia/shared";
import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { sessions } from "../db/schema.js";
import {
  computeRemaining,
  getRemainingBudget,
  spend,
} from "./activity.js";
import { openOrGetSession } from "./sessions.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";
import { createBoardMcpServer } from "../mcp/create-server.js";

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
});

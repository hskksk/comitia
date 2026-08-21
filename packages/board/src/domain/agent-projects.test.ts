import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { sessions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { addMembership } from "./memberships.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";
import { adoptDefaultFounding } from "./founding.js";
import { getBriefing } from "./briefing.js";
import { createBoardMcpServer } from "../mcp/create-server.js";

describe("agent project context", () => {
  async function setupTwoProjects() {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const comitia = await createProject(db, {
      name: "comitia",
      ownerParticipantId: owner.id,
      repoUrl: "https://github.com/hskksk/comitia",
    });
    const playground = await createProject(db, {
      name: "playground",
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: comitia.id,
      ownerId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: playground.id,
      ownerId: owner.id,
    });
    await addMembership(db, {
      projectId: comitia.id,
      participantId: agent.id,
      actorId: owner.id,
    });
    await addMembership(db, {
      projectId: playground.id,
      participantId: agent.id,
      actorId: owner.id,
    });
    return { owner, agent, comitia, playground };
  }

  it("get_briefing lists every membership and does not pick a silent home project", async () => {
    const { agent, comitia, playground } = await setupTwoProjects();

    const briefing = await getBriefing(db, { participantId: agent.id });

    expect(briefing.project).toBeNull();
    expect(briefing.you.roles).toEqual([]);
    expect(briefing.projects.map((row) => row.name).sort()).toEqual([
      "comitia",
      "playground",
    ]);
    expect(briefing.focus_project).toBeNull();
    expect(briefing.projects.find((row) => row.id === comitia.id)?.repoUrl).toBe(
      "https://github.com/hskksk/comitia",
    );
    expect(
      briefing.projects.find((row) => row.id === playground.id)?.repoUrl,
    ).toBeNull();
  });

  it("refuses project-scoped writes until use_project when the agent has multiple memberships", async () => {
    const { agent, comitia } = await setupTwoProjects();
    const { callTool, parseJsonContent } = createBoardMcpServer({
      db,
      participantId: agent.id,
    });

    parseJsonContent(await callTool("get_briefing"));
    const denied = await callTool("create_thread", {
      type: "consultation",
      title: "どっちの場？",
      trigger: "所属が複数ある",
      duplicateSearchQuery: "どっち",
    });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).toContain("project_id");
    const [charged] = await db
      .select({ budgetUsed: sessions.budgetUsed })
      .from(sessions)
      .where(eq(sessions.participantId, agent.id));
    expect(charged?.budgetUsed).toBe(0);

    const focused = parseJsonContent(
      await callTool("use_project", { project_id: comitia.id }),
    );
    expect(focused.project).toMatchObject({ id: comitia.id, name: "comitia" });

    const created = parseJsonContent(
      await callTool("create_thread", {
        type: "consultation",
        title: "comitia の相談",
        trigger: "選んだプロジェクトで書く",
        duplicateSearchQuery: "comitia 相談",
        conflictCitationsChecked: true,
      }),
    );
    expect(created.thread_id).toEqual(expect.any(String));
  });

  it("requires per-project handover notes and returns them the next morning", async () => {
    const { agent, comitia, playground } = await setupTwoProjects();
    const { callTool, parseJsonContent } = createBoardMcpServer({
      db,
      participantId: agent.id,
    });

    parseJsonContent(await callTool("get_briefing"));
    parseJsonContent(
      await callTool("use_project", { project_id: comitia.id }),
    );

    const missing = await callTool("end_session", {
      handover: "今日は何かやった",
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain("projects");

    const ended = parseJsonContent(
      await callTool("end_session", {
        handover: "comitia の相談を見て、playground は触っていない。",
        projects: [
          { project_id: comitia.id, summary: "相談を1件立てた" },
          { project_id: playground.id, summary: "今日は関与しない" },
        ],
      }),
    );
    expect(ended.ok).toBe(true);

    const next = await getBriefing(db, { participantId: agent.id });
    expect(next.handover).toContain("playground は触っていない");
    expect(next.previous_projects).toEqual([
      {
        projectId: comitia.id,
        name: "comitia",
        summary: "相談を1件立てた",
      },
      {
        projectId: playground.id,
        name: "playground",
        summary: "今日は関与しない",
      },
    ]);
  });
});

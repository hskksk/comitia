import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import type { SharedArtifactKind } from "@comitia/shared";
import { getSystemTemplate } from "../catalog/index.js";
import { agreements } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { seedDecidedImplementation, seedOwnerAgentProject } from "../test/human-fixtures.js";
import { createBoardMcpServer } from "../mcp/create-server.js";
import { getBriefing } from "./briefing.js";
import {
  getActiveSharedArtifact,
  listSharedArtifacts,
} from "./constitution.js";
import { listHumanAgreements } from "./human-ops.js";
import { addMembership } from "./memberships.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";
import { addProposal } from "./proposals.js";
import { createThread } from "./threads.js";

async function adoptShared(input: {
  projectId: string;
  ownerId: string;
  kind: SharedArtifactKind;
  title: string;
  content: string;
  summary?: string;
  createdAt?: Date;
}) {
  const thread = await createThread(db, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    type: "proposal",
    target: "shared_artifact",
    sharedArtifactKind: input.kind,
    title: input.title,
    trigger: input.title,
    duplicateSearchQuery: input.title,
    conflictCitationsChecked: true,
  });
  const { version } = await addProposal(db, {
    threadId: thread.id,
    authorId: input.ownerId,
    content: input.content,
  });
  const [agreement] = await db
    .insert(agreements)
    .values({
      projectId: input.projectId,
      threadId: thread.id,
      proposalVersionId: version.id,
      outcome: "adopted",
      binding: true,
      state: "active",
      summary: input.summary ?? input.title,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();
  return { thread, agreement: agreement!, version };
}

describe("listSharedArtifacts (M25-1)", () => {
  it("returns the same project_rule body as the dashboard helper", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    const dashboard = await getActiveSharedArtifact(
      db,
      project.id,
      "project_rule",
    );
    const listed = await listSharedArtifacts(db, {
      projectId: project.id,
      kind: "project_rule",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      kind: "project_rule",
      threadId: dashboard!.threadId,
      summary: dashboard!.summary,
      content: dashboard!.content,
    });
    expect(listed[0]!.content).toContain("プロジェクトルール");
  });

  it("returns the adopted thread_template body, distinct from the catalog id", async () => {
    const { project } = await seedOwnerAgentProject(db);
    const listed = await listSharedArtifacts(db, {
      projectId: project.id,
      kind: "thread_template",
    });
    const catalog = getSystemTemplate("thread_template", "default");
    expect(listed).toHaveLength(1);
    expect(listed[0]!.content).toBe(catalog!.content);
    expect(listed[0]!.threadId).not.toBe(catalog!.id);
  });

  it("returns every adopted skill and only the latest constitution kind", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    const original = await getActiveSharedArtifact(
      db,
      project.id,
      "project_rule",
    );
    await adoptShared({
      projectId: project.id,
      ownerId: owner.id,
      kind: "project_rule",
      title: "改正ルール",
      content: "# 改正後の憲法",
      summary: "改正後",
      createdAt: new Date(Date.now() + 60_000),
    });
    await adoptShared({
      projectId: project.id,
      ownerId: owner.id,
      kind: "skill",
      title: "スキルA",
      content: "手順A",
      createdAt: new Date(Date.now() + 1_000),
    });
    await adoptShared({
      projectId: project.id,
      ownerId: owner.id,
      kind: "skill",
      title: "スキルB",
      content: "手順B",
      createdAt: new Date(Date.now() + 2_000),
    });

    const listed = await listSharedArtifacts(db, { projectId: project.id });
    const rules = listed.filter((row) => row.kind === "project_rule");
    const skills = listed.filter((row) => row.kind === "skill");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.content).toBe("# 改正後の憲法");
    expect(rules[0]!.threadId).not.toBe(original!.threadId);
    expect(skills.map((row) => row.summary)).toEqual(["スキルA", "スキルB"]);
    expect(listed.map((row) => row.kind)).toEqual([
      "project_rule",
      "thread_template",
      "skill",
      "skill",
    ]);
  });
});

describe("briefing.shared_artifacts (M25-1)", () => {
  it("starts empty when nothing is adopted", async () => {
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
    const project = await createProject(db, {
      name: "empty",
      ownerParticipantId: owner.id,
    });
    await addMembership(db, {
      projectId: project.id,
      participantId: agent.id,
      actorId: owner.id,
    });
    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(briefing.shared_artifacts).toEqual({
      project_rule: null,
      thread_template: null,
      skills: [],
    });
    expect(briefing.projects[0]?.shared_artifacts).toEqual(
      briefing.shared_artifacts,
    );
  });

  it("puts constitution bodies in the morning pack and skills as pointers", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    await adoptShared({
      projectId: project.id,
      ownerId: owner.id,
      kind: "skill",
      title: "レビュー手順",
      content: "PR は人間がマージする",
    });

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    const listed = await listSharedArtifacts(db, { projectId: project.id });
    const rule = listed.find((row) => row.kind === "project_rule")!;
    expect(briefing.shared_artifacts.project_rule).toEqual({
      threadId: rule.threadId,
      summary: rule.summary,
      content: rule.content,
    });
    expect(briefing.shared_artifacts.thread_template?.content).toBeTruthy();
    expect(briefing.shared_artifacts.skills).toEqual([
      { threadId: expect.any(String), summary: "レビュー手順" },
    ]);
    expect(JSON.stringify(briefing.shared_artifacts.skills)).not.toContain(
      "PR は人間がマージする",
    );
  });

  it("surfaces a later adopted project_rule body on the next briefing", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    await adoptShared({
      projectId: project.id,
      ownerId: owner.id,
      kind: "project_rule",
      title: "次セッションのルール",
      content: "# 次セッションから使う本文",
      createdAt: new Date(Date.now() + 60_000),
    });

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(briefing.shared_artifacts.project_rule?.content).toBe(
      "# 次セッションから使う本文",
    );
  });
});

describe("search_decisions DTO (M25-1)", () => {
  it("returns proposalContent and sharedArtifactKind like the human agreement list", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const rows = await listHumanAgreements(db, {
      projectId: project.id,
      state: "all",
    });
    const founding = rows.find((row) => row.sharedArtifactKind === "project_rule");
    const decided = rows.find((row) => row.threadId === thread.id);
    expect(founding?.proposalContent).toContain("プロジェクトルール");
    expect(founding?.target).toBe("shared_artifact");
    expect(decided?.proposalContent).toBe("Comittia → Comitia");
    expect(decided?.sharedArtifactKind).toBeNull();
    expect(decided?.target).toBeNull();
    void owner;
  });

  it("keeps onlyActiveBinding and can filter by sharedArtifactKind", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const binding = await listHumanAgreements(db, {
      projectId: project.id,
      onlyActiveBinding: true,
    });
    expect(
      binding.every((row) => row.binding && row.state === "active"),
    ).toBe(true);
    expect(
      binding.some((row) => row.sharedArtifactKind === "project_rule"),
    ).toBe(true);
    expect(binding.some((row) => row.threadTitle?.includes("typo"))).toBe(false);

    const skills = await listHumanAgreements(db, {
      projectId: project.id,
      state: "all",
      sharedArtifactKind: "skill",
    });
    expect(skills).toEqual([]);
    void owner;
  });
});

describe("MCP list_shared_artifacts / search_decisions (M25-1)", () => {
  it("exposes adopted bodies at cost 0", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { callTool, parseJsonContent } = createBoardMcpServer({
      db,
      participantId: agent.id,
      projectId: project.id,
    });
    const briefing = parseJsonContent(await callTool("get_briefing"));
    const budget = briefing.remaining_budget as number;

    const listed = parseJsonContent(await callTool("list_shared_artifacts", {}));
    expect(listed.remaining_budget).toBe(budget);
    const artifacts = listed.artifacts as Array<{
      kind: string;
      content: string;
    }>;
    expect(artifacts.some((row) => row.kind === "project_rule")).toBe(true);
    expect(
      artifacts.find((row) => row.kind === "project_rule")?.content,
    ).toContain("プロジェクトルール");

    const catalog = parseJsonContent(
      await callTool("list_system_templates", { kind: "project_rule" }),
    );
    const templates = catalog.templates as Array<{ id: string }>;
    expect(templates[0]?.id).toBe("default");

    const decisions = parseJsonContent(
      await callTool("search_decisions", { onlyActiveBinding: true }),
    );
    const agreements = decisions.agreements as Array<{
      proposalContent: string;
      sharedArtifactKind: string | null;
    }>;
    expect(
      agreements.some(
        (row) =>
          row.sharedArtifactKind === "project_rule" &&
          row.proposalContent.includes("プロジェクトルール"),
      ),
    ).toBe(true);
  });
});

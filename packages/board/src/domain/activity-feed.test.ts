import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { events } from "../db/schema.js";
import {
  seedDecidedImplementation,
  seedOwnerAgentProject,
} from "../test/human-fixtures.js";
import { listRecentActivity } from "./activity-feed.js";
import { recordEvent } from "./events.js";
import { addPost } from "./posts.js";
import { createThread } from "./threads.js";
import { registerParticipant } from "./participants.js";
import {
  addMembership,
  removeHumanMember,
} from "./memberships.js";
import { createProject } from "./projects.js";
import { addProposal } from "./proposals.js";
import { declare } from "./declare.js";
import { listRecentEvents } from "./human-ops.js";
import { assignRole } from "./roles.js";
import { PermissionDenied } from "./errors.js";
import { claimWork } from "./work-claims.js";

describe("listRecentActivity", () => {
  it("filters runtime noise before limit and enriches an agent post", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await db.delete(events);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "consultation",
      title: "認証方式を決める",
      trigger: "鍵の扱いを決める",
      duplicateSearchQuery: "認証 鍵",
      consensusType: "rough",
      conflictCitationsChecked: true,
    });
    const body = "あ".repeat(121);
    await addPost(db, {
      threadId: thread.id,
      authorId: agent.id,
      type: "comment",
      body,
    });
    for (let index = 0; index < 20; index += 1) {
      await recordEvent(db, {
        projectId: project.id,
        actorParticipantId: agent.id,
        kind: index % 2 === 0 ? "tick_delivered" : "budget_spent",
        payload: { index },
      });
    }

    const items = await listRecentActivity(db, {
      projectId: project.id,
      limit: 1,
    });

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.kind).toBe("post_added");
    expect(item?.actor).toMatchObject({
      displayName: "ミカ@ハル",
      kind: "agent",
    });
    expect(item?.subject).toMatchObject({
      type: "thread",
      title: "認証方式を決める",
    });
    if (item?.kind !== "post_added") throw new Error("unexpected activity");
    expect(item.detail).toEqual({
      type: "post",
      postId: expect.any(String),
      postType: "comment",
      preview: `${"あ".repeat(120)}…`,
    });
  });

  it("filters caused child events and automatic releases before limit", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    await db.delete(events);
    await recordEvent(db, {
      projectId: project.id,
      actorParticipantId: owner.id,
      kind: "project_updated",
      payload: { name: "comitia", repoUrl: null },
    });
    for (let index = 0; index < 15; index += 1) {
      await recordEvent(db, {
        projectId: project.id,
        actorParticipantId: owner.id,
        kind: "post_added",
        payload: { postId: crypto.randomUUID(), cause: "work_claimed" },
      });
      await recordEvent(db, {
        projectId: project.id,
        actorParticipantId: owner.id,
        kind: "work_released",
        payload: {
          claimId: crypto.randomUUID(),
          reason: "thread_closed",
        },
      });
    }

    const items = await listRecentActivity(db, {
      projectId: project.id,
      limit: 1,
    });
    expect(items.map((item) => item.kind)).toEqual(["project_updated"]);
  });

  it("represents a work claim without its automatic report post", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    await db.delete(events);
    await claimWork(db, {
      threadId: thread.id,
      participantId: agent.id,
      paths: ["packages/board/src/", "packages/web/src/", "README.md", "docs/"],
    });

    const items = await listRecentActivity(db, {
      projectId: project.id,
      limit: 10,
    });
    expect(items.map((item) => item.kind)).toEqual(["work_claimed"]);
    const [item] = items;
    if (item?.kind !== "work_claimed") throw new Error("unexpected activity");
    expect(item.detail).toEqual({
      type: "work",
      paths: ["packages/board/src/", "packages/web/src/", "README.md"],
      pathCount: 4,
    });
  });

  it("represents declarations once with typed proposal context", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await db.delete(events);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "implementation",
      title: "検索 API",
      trigger: "検索を追加する",
      duplicateSearchQuery: "検索 API",
      consensusType: "owner_decision",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "検索 API を追加する",
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
      payload: { binding: false, summary: "実装する" },
    });

    const items = await listRecentActivity(db, {
      projectId: project.id,
      limit: 20,
    });

    const declarations = items.filter(
      (item) => item.kind === "thread_declaration",
    );
    expect(declarations).toHaveLength(2);
    const selected = declarations.find(
      (item) => item.detail.declarationKind === "select_candidate",
    );
    expect(selected?.detail).toMatchObject({
      proposalNumber: 1,
      versionNumber: 1,
    });
    const decided = declarations.find(
      (item) => item.detail.declarationKind === "owner_decide",
    );
    expect(decided?.detail.summary).toBe("実装する");
  });

  it("collapses project founding into the project-created activity", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "新しい場",
      ownerParticipantId: owner.id,
      projectRule: { content: "ルール" },
      threadTemplate: { content: "テンプレート" },
    });

    const items = await listRecentActivity(db, {
      projectId: project.id,
      limit: 20,
    });
    expect(items.map((item) => item.kind)).toEqual(["project_created"]);
  });

  it("uses a removal snapshot and does not join legacy targets across projects", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    const removed = await registerParticipant(db, {
      kind: "human",
      displayName: "ユイ",
    });
    await addMembership(db, {
      projectId: project.id,
      participantId: removed.id,
      actorId: owner.id,
    });
    await db.delete(events);
    await removeHumanMember(db, {
      projectId: project.id,
      participantId: removed.id,
      actorId: owner.id,
    });
    const outsider = await registerParticipant(db, {
      kind: "human",
      displayName: "別プロジェクトの人",
    });
    await recordEvent(db, {
      projectId: project.id,
      actorParticipantId: owner.id,
      kind: "project_membership_removed",
      payload: { participantId: outsider.id },
    });

    const items = await listRecentActivity(db, {
      projectId: project.id,
      limit: 10,
    });
    const removals = items.filter(
      (item) => item.kind === "project_membership_removed",
    );
    expect(removals).toHaveLength(2);
    expect(removals[0]?.detail.displayName).toBeNull();
    expect(removals[1]?.detail).toMatchObject({
      displayName: "ユイ",
      participantKind: "human",
    });
  });

  it("keeps session details private and renders interruption as system action", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    await db.delete(events);
    await recordEvent(db, {
      projectId: project.id,
      actorParticipantId: agent.id,
      kind: "session_ended",
      payload: {
        sessionId: crypto.randomUUID(),
        projects: [
          {
            projectId: crypto.randomUUID(),
            name: "秘密の別プロジェクト",
            summary: "非公開の申し送り",
          },
        ],
      },
    });
    await recordEvent(db, {
      projectId: project.id,
      actorParticipantId: agent.id,
      kind: "session_interrupted",
      payload: { sessionId: crypto.randomUUID() },
    });

    const activity = await listRecentActivity(db, {
      projectId: project.id,
      limit: 10,
    });
    const interrupted = activity.find(
      (item) => item.kind === "session_interrupted",
    );
    expect(interrupted?.actor).toBeNull();
    expect(interrupted?.detail).toMatchObject({
      displayName: "ミカ@ハル",
      participantId: agent.id,
    });
    expect(JSON.stringify(activity)).not.toContain("非公開の申し送り");

    const auditWindow = await listRecentEvents(db, {
      projectId: project.id,
      limit: 10,
    });
    expect(JSON.stringify(auditWindow)).not.toContain("非公開の申し送り");
    const ended = auditWindow.find((item) => item.kind === "session_ended");
    expect(ended?.payload).not.toHaveProperty("projects");
  });
});

describe("assignRole", () => {
  it("rejects a participant outside the project", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    const outsider = await registerParticipant(db, {
      kind: "human",
      displayName: "外部",
    });
    await expect(
      assignRole(db, {
        projectId: project.id,
        participantId: outsider.id,
        role: "reviewer",
        actorId: owner.id,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

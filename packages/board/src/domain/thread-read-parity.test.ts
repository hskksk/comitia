import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { seedDecidedImplementation, seedOwnerAgentProject } from "../test/human-fixtures.js";
import { createBoardMcpServer } from "../mcp/create-server.js";
import { addPost } from "./posts.js";
import { addProposal } from "./proposals.js";
import { readThread } from "./read-thread.js";
import { createThread, searchThreadsForAgent } from "./threads.js";
import { claimWork } from "./work-claims.js";

describe("searchThreadsForAgent (M25-2)", () => {
  it("filters by sharedArtifactKind and returns public thread metadata", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    const consult = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "consultation",
      title: "相談",
      trigger: "確認",
      duplicateSearchQuery: "consult",
      conflictCitationsChecked: true,
    });

    const rules = await searchThreadsForAgent(db, {
      projectId: project.id,
      sharedArtifactKind: "project_rule",
    });
    expect(rules.length).toBeGreaterThanOrEqual(1);
    expect(rules.every((row) => row.sharedArtifactKind === "project_rule")).toBe(
      true,
    );
    expect(rules[0]).toMatchObject({
      target: "shared_artifact",
      consensusType: "human_ratification",
      ownerParticipantId: owner.id,
    });
    expect(rules.some((row) => row.id === consult.id)).toBe(false);

    const all = await searchThreadsForAgent(db, { projectId: project.id });
    const consultRow = all.find((row) => row.id === consult.id);
    expect(consultRow).toMatchObject({
      id: consult.id,
      title: "相談",
      type: "consultation",
      state: "discussing",
      target: null,
      sharedArtifactKind: null,
      workPhase: null,
      ownerParticipantId: owner.id,
    });
  });
});

describe("readThread public metadata (M25-2)", () => {
  it("includes target, kind, consensus, all proposals, claims, and author labels", async () => {
    const { owner, agent, project } = await seedOwnerAgentProject(db);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      title: "スキル案",
      trigger: "手順を共有する",
      duplicateSearchQuery: "skill share",
      target: "shared_artifact",
      sharedArtifactKind: "skill",
      consensusType: "rough",
      conflictCitationsChecked: true,
    });
    const first = await addProposal(db, {
      threadId: thread.id,
      authorId: owner.id,
      content: "候補ではない案",
    });
    const second = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "いまの候補",
    });
    await addPost(db, {
      threadId: thread.id,
      authorId: agent.id,
      type: "position",
      body: "この案でよい",
    });

    const { thread: decided } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    await claimWork(db, {
      threadId: decided.id,
      participantId: agent.id,
      paths: ["docs/"],
    });

    const view = await readThread(db, thread.id);
    expect(view.thread).toMatchObject({
      title: "スキル案",
      type: "proposal",
      state: "discussing",
      target: "shared_artifact",
      sharedArtifactKind: "skill",
      consensusType: "rough",
      humanRequired: false,
      ownerParticipantId: owner.id,
      awaitingEnteredAt: null,
      timingEndsAt: null,
    });
    expect(view.proposals).toEqual([
      expect.objectContaining({
        id: first.proposal.id,
        number: 1,
        content: "候補ではない案",
      }),
      expect.objectContaining({
        id: second.proposal.id,
        number: 2,
        content: "いまの候補",
      }),
    ]);
    expect(view.workClaims).toEqual([]);
    const agentPost = view.posts.find((post) => post.body === "この案でよい");
    expect(agentPost?.authorDisplayName).toBe("ミカ@ハル");
    expect(agentPost?.createdAt).toEqual(expect.stringMatching(/^\d{4}-/));

    const claimed = await readThread(db, decided.id);
    expect(claimed.workClaims).toEqual([
      expect.objectContaining({
        participantId: agent.id,
        displayName: "ミカ",
        paths: ["docs/"],
      }),
    ]);
  });
});

describe("MCP search_threads / read_thread (M25-2)", () => {
  it("lets an agent find a project_rule thread and read the public fields", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { callTool, parseJsonContent } = createBoardMcpServer({
      db,
      participantId: agent.id,
      projectId: project.id,
    });
    parseJsonContent(await callTool("get_briefing"));

    const search = parseJsonContent(
      await callTool("search_threads", {
        sharedArtifactKind: "project_rule",
      }),
    );
    const threads = search.threads as Array<{
      id: string;
      sharedArtifactKind: string | null;
      target: string | null;
    }>;
    expect(threads.length).toBeGreaterThanOrEqual(1);
    expect(
      threads.every((row) => row.sharedArtifactKind === "project_rule"),
    ).toBe(true);

    const view = parseJsonContent(
      await callTool("read_thread", { thread_id: threads[0]!.id }),
    );
    const thread = view.thread as {
      target: string;
      sharedArtifactKind: string;
      consensusType: string;
    };
    expect(thread.target).toBe("shared_artifact");
    expect(thread.sharedArtifactKind).toBe("project_rule");
    expect(thread.consensusType).toBe("human_ratification");
    expect(Array.isArray(view.proposals)).toBe(true);
    expect(Array.isArray(view.workClaims)).toBe(true);
  });
});

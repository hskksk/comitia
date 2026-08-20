import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import {
  seedDecidedImplementation,
  seedOwnerAgentProject,
} from "../test/human-fixtures.js";
import { declare } from "./declare.js";
import { getDecisionView, renderUnifiedDiff } from "./decision-view.js";
import { addProposal, addProposalVersion } from "./proposals.js";
import { spend } from "./activity.js";
import { openOrGetSession } from "./sessions.js";
import { createThread } from "./threads.js";

describe("renderUnifiedDiff", () => {
  it("marks removed and added lines", () => {
    const diff = renderUnifiedDiff("line1\nline2\n", "line1\nline3\n");
    expect(diff).toContain("- line2");
    expect(diff).toContain("+ line3");
    expect(diff).toContain("  line1");
  });
});

describe("getDecisionView", () => {
  it("returns null for a thread that is not decided/completed/rejected", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "consultation",
      title: "検討",
      trigger: "確認",
      duplicateSearchQuery: "検討",
    });
    const view = await getDecisionView(db, thread.id);
    expect(view).toBeNull();
  });

  it("returns a null diff for a v1-only decided thread", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });
    const view = await getDecisionView(db, thread.id);
    expect(view).not.toBeNull();
    expect(view?.diff).toBeNull();
  });

  it("computes a diff against the previous version of the same proposal", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "implementation",
      title: "版の差分テスト",
      trigger: "テスト",
      duplicateSearchQuery: "版の差分",
      consensusType: "owner_decision",
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "v1 の内容",
    });
    const v2 = await addProposalVersion(db, {
      proposalId: version.proposalId,
      authorId: agent.id,
      content: "v2 の内容",
    });
    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "select_candidate",
      payload: { proposalVersionId: v2.id },
    });
    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "owner_decide",
      payload: { binding: false, summary: "v2 を採用" },
    });

    const view = await getDecisionView(db, thread.id);
    expect(view?.diff).toContain("+ v2 の内容");
  });

  it("sums budget_spent events tagged with the thread id as activitySpent", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { thread } = await seedDecidedImplementation(db, {
      agentId: agent.id,
      projectId: project.id,
    });

    const before = await getDecisionView(db, thread.id);
    expect(before?.activitySpent).toBe(0);

    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await spend(db, session.id, "read_thread", thread.id);

    const after = await getDecisionView(db, thread.id);
    expect(after?.activitySpent).toBe(3);
  });
});

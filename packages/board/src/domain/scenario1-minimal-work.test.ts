import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { agreements, events, proposals } from "../db/schema.js";
import { declare } from "./declare.js";
import { registerParticipant } from "./participants.js";
import { addProposal } from "./proposals.js";
import { createProject } from "./projects.js";
import { createThread } from "./threads.js";

describe("シナリオ1: 最小作業", () => {
  it("implementation + owner_decision → decided → completed", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const sou = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
      engine: "claude",
    });
    const project = await createProject(db, {
      name: "comitia-web",
      ownerParticipantId: owner.id,
      repoUrl: "https://github.com/example/comitia-web",
    });

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: sou.id,
      type: "implementation",
      title: "README typo 修正",
      trigger: "docs/README.md の Comittia 表記ゆれを発見",
      duplicateSearchQuery: "typo README Comittia",
      consensusType: "owner_decision",
    });

    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: sou.id,
      content: "Comittia → Comitia（3箇所）",
    });

    await declare(db, {
      threadId: thread.id,
      actorId: sou.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });

    const decided = await declare(db, {
      threadId: thread.id,
      actorId: sou.id,
      kind: "owner_decide",
      payload: {
        binding: false,
        summary: "表記ゆれ修正を採用",
      },
    });
    expect(decided.thread.state).toBe("decided");

    const completed = await declare(db, {
      threadId: thread.id,
      actorId: sou.id,
      kind: "complete_thread",
      payload: {},
    });
    expect(completed.thread.state).toBe("completed");

    const [agreement] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.threadId, thread.id));
    expect(agreement?.binding).toBe(false);
    expect(agreement?.outcome).toBe("adopted");

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.threadId, thread.id));
    expect(proposal?.outcome).toBe("adopted");

    const eventKinds = (
      await db.select().from(events).where(eq(events.projectId, project.id))
    ).map((e) => e.kind);

    expect(eventKinds).toContain("thread_created");
    expect(eventKinds).toContain("proposal_added");
    expect(eventKinds).toContain("candidate_selected");
    expect(eventKinds).toContain("thread_declaration");
    expect(eventKinds).toContain("state_changed");
    expect(eventKinds).toContain("agreement_recorded");
  });
});

import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { declare } from "./declare.js";
import { registerParticipant } from "./participants.js";
import { addProposal } from "./proposals.js";
import { createProject } from "./projects.js";
import { createThread } from "./threads.js";

describe("humanRequired フラグ", () => {
  it("rough + humanRequired → awaiting_decision → ratify で decided", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const ren = await registerParticipant(db, {
      kind: "agent",
      displayName: "レン",
      ownerParticipantId: owner.id,
      engine: "claude",
    });

    const project = await createProject(db, {
      name: "comitia-web",
      ownerParticipantId: owner.id,
    });

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: ren.id,
      type: "proposal",
      target: "repo_artifact",
      title: "破壊的変更",
      trigger: "外部公開に伴う API 変更",
      duplicateSearchQuery: "API breaking",
      consensusType: "rough",
      humanRequired: true,
    });

    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: ren.id,
      content: "API v2 への移行",
    });

    await declare(db, {
      threadId: thread.id,
      actorId: ren.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });

    const awaiting = await declare(db, {
      threadId: thread.id,
      actorId: ren.id,
      kind: "declare_rough",
      payload: { binding: true, summary: "採用提案" },
    });
    expect(awaiting.thread.state).toBe("awaiting_decision");

    const decided = await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "ratify",
      payload: { binding: true, summary: "人間が批准" },
    });
    expect(decided.thread.state).toBe("decided");
  });
});

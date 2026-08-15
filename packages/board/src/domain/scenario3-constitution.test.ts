import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { declare } from "./declare.js";
import { GateViolation, InvalidTransition, PermissionDenied } from "./errors.js";
import { registerParticipant } from "./participants.js";
import { addProposal } from "./proposals.js";
import { createProject } from "./projects.js";
import { createThread } from "./threads.js";

describe("シナリオ3: 憲法改正", () => {
  it("project_rule は human_ratification 固定・批准フロー", async () => {
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
    });

    await expect(
      createThread(db, {
        projectId: project.id,
        ownerId: sou.id,
        type: "proposal",
        target: "shared_artifact",
        sharedArtifactKind: "project_rule",
        title: "合意物区分の導入",
        trigger: "衝突チェックの検索ノイズ",
        duplicateSearchQuery: "合意物 提案集",
        consensusType: "rough",
      }),
    ).rejects.toThrow(GateViolation);

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: sou.id,
      type: "proposal",
      target: "shared_artifact",
      sharedArtifactKind: "project_rule",
      title: "合意物区分の導入",
      trigger: "衝突チェックの検索ノイズ",
      duplicateSearchQuery: "合意物 提案集",
    });
    expect(thread.consensusType).toBe("human_ratification");

    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: sou.id,
      content: "拘束的/非拘束の区分を導入",
    });

    await declare(db, {
      threadId: thread.id,
      actorId: sou.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: sou.id,
        kind: "declare_rough",
        payload: { binding: true, summary: "採用" },
      }),
    ).rejects.toThrow(InvalidTransition);

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: sou.id,
        kind: "owner_decide",
        payload: { binding: true, summary: "採用" },
      }),
    ).rejects.toThrow(InvalidTransition);

    const awaiting = await declare(db, {
      threadId: thread.id,
      actorId: sou.id,
      kind: "request_ratification",
      payload: {},
    });
    expect(awaiting.thread.state).toBe("awaiting_decision");

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: sou.id,
        kind: "ratify",
        payload: { binding: true, summary: "批准" },
      }),
    ).rejects.toThrow(PermissionDenied);

    const sentBack = await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "send_back",
      payload: { reason: "区分への異議権を明記して" },
    });
    expect(sentBack.thread.state).toBe("discussing");

    await declare(db, {
      threadId: thread.id,
      actorId: sou.id,
      kind: "request_ratification",
      payload: {},
    });

    const decided = await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "ratify",
      payload: { binding: true, summary: "v3 を批准" },
    });
    expect(decided.thread.state).toBe("decided");
  });
});

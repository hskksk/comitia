import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { GateViolation, PermissionDenied } from "./errors.js";
import { registerParticipant } from "./participants.js";
import { addPost } from "./posts.js";
import { addProposal } from "./proposals.js";
import { createProject } from "./projects.js";
import { createThread } from "./threads.js";

describe("門の強制", () => {
  it("trigger 空は GateViolation", async () => {
    const human = await registerParticipant(db, {
      kind: "human",
      displayName: "オーナー",
    });
    const project = await createProject(db, {
      name: "p",
      ownerParticipantId: human.id,
    });
    await expect(
      createThread(db, {
        projectId: project.id,
        ownerId: human.id,
        type: "consultation",
        title: "t",
        trigger: "  ",
        duplicateSearchQuery: "q",
      }),
    ).rejects.toThrow(GateViolation);
  });

  it("duplicateSearchQuery 空は GateViolation", async () => {
    const human = await registerParticipant(db, {
      kind: "human",
      displayName: "オーナー",
    });
    const project = await createProject(db, {
      name: "p",
      ownerParticipantId: human.id,
    });
    await expect(
      createThread(db, {
        projectId: project.id,
        ownerId: human.id,
        type: "consultation",
        title: "t",
        trigger: "きっかけ",
        duplicateSearchQuery: "",
      }),
    ).rejects.toThrow(GateViolation);
  });

  it("賛成・異議は根拠必須", async () => {
    const human = await registerParticipant(db, {
      kind: "human",
      displayName: "オーナー",
    });
    const project = await createProject(db, {
      name: "p",
      ownerParticipantId: human.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: human.id,
      type: "proposal",
      target: "repo_artifact",
      title: "t",
      trigger: "きっかけ",
      duplicateSearchQuery: "q",
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: human.id,
      content: "案",
    });
    await expect(
      addPost(db, {
        threadId: thread.id,
        authorId: human.id,
        type: "approval",
        body: "賛成",
        proposalVersionId: version.id,
      }),
    ).rejects.toThrow("根拠必須");
  });

  it("賛成・異議は版指定必須", async () => {
    const human = await registerParticipant(db, {
      kind: "human",
      displayName: "オーナー",
    });
    const project = await createProject(db, {
      name: "p",
      ownerParticipantId: human.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: human.id,
      type: "proposal",
      target: "repo_artifact",
      title: "t",
      trigger: "きっかけ",
      duplicateSearchQuery: "q",
    });
    await expect(
      addPost(db, {
        threadId: thread.id,
        authorId: human.id,
        type: "objection",
        body: "反対",
        rationale: "理由",
        blocking: true,
      }),
    ).rejects.toThrow("提案版が必須");
  });

  it("ブレストには賛成・異議・提案を出せない", async () => {
    const human = await registerParticipant(db, {
      kind: "human",
      displayName: "オーナー",
    });
    const project = await createProject(db, {
      name: "p",
      ownerParticipantId: human.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: human.id,
      type: "brainstorm",
      title: "t",
      trigger: "きっかけ",
      duplicateSearchQuery: "q",
    });
    await expect(
      addProposal(db, {
        threadId: thread.id,
        authorId: human.id,
        content: "案",
      }),
    ).rejects.toThrow(GateViolation);
    await expect(
      addPost(db, {
        threadId: thread.id,
        authorId: human.id,
        type: "approval",
        body: "賛成",
        rationale: "理由",
        blocking: undefined,
        proposalVersionId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow(GateViolation);
  });

  it("プロジェクトオーナーは人間でなければならない", async () => {
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "AI",
      engine: "claude",
    });
    await expect(
      createProject(db, {
        name: "p",
        ownerParticipantId: agent.id,
      }),
    ).rejects.toThrow(PermissionDenied);
  });

  it("declaration は declare() 経由のみ", async () => {
    const human = await registerParticipant(db, {
      kind: "human",
      displayName: "オーナー",
    });
    const project = await createProject(db, {
      name: "p",
      ownerParticipantId: human.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: human.id,
      type: "implementation",
      title: "t",
      trigger: "きっかけ",
      duplicateSearchQuery: "q",
      consensusType: "owner_decision",
    });
    await expect(
      addPost(db, {
        threadId: thread.id,
        authorId: human.id,
        type: "declaration",
        body: "宣言",
      }),
    ).rejects.toThrow(GateViolation);
  });
});

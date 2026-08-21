import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { agreements, proposals } from "../db/schema.js";
import { declare } from "./declare.js";
import { GateViolation, InvalidTransition } from "./errors.js";
import { registerParticipant } from "./participants.js";
import { addPost } from "./posts.js";
import { addProposal, addProposalVersion } from "./proposals.js";
import { createProject } from "./projects.js";
import { assignRole } from "./roles.js";
import { createThread } from "./threads.js";
import { adoptDefaultFounding } from "./founding.js";

describe("シナリオ2: 対立する設計判断", () => {
  it("rough 合意・異議・衝突チェック", async () => {
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
    const sou = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
      engine: "claude",
    });
    const mika = await registerParticipant(db, {
      kind: "agent",
      displayName: "ミカ",
      ownerParticipantId: owner.id,
      engine: "claude",
    });
    const yui = await registerParticipant(db, {
      kind: "agent",
      displayName: "ユイ",
      ownerParticipantId: owner.id,
      engine: "opencode",
    });

    const project = await createProject(db, {
      name: "comitia-web",
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });

    for (const [participantId, role] of [
      [ren.id, "proposer"],
      [sou.id, "reviewer"],
      [mika.id, "facilitator"],
    ] as const) {
      await assignRole(db, {
        projectId: project.id,
        participantId,
        role,
        actorId: owner.id,
      });
    }

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: ren.id,
      type: "proposal",
      target: "repo_artifact",
      title: "検索インデックスの更新方式",
      trigger: "投稿の検索反映が遅い（ユーザー影響）",
      duplicateSearchQuery: "検索インデックス 更新",
      consensusType: "rough",
      conflictCitationsChecked: true,
    });

    const { proposal: proposalA, version: aV1 } = await addProposal(db, {
      threadId: thread.id,
      authorId: ren.id,
      content: "案A: 同期更新",
    });
    const { proposal: proposalB } = await addProposal(db, {
      threadId: thread.id,
      authorId: yui.id,
      content: "案B: 非同期ジョブ",
    });

    await addPost(db, {
      threadId: thread.id,
      authorId: sou.id,
      type: "objection",
      body: "書き込みレイテンシが増える",
      rationale: "書き込み経路を重くしたくない",
      blocking: true,
      proposalVersionId: aV1.id,
    });

    await declare(db, {
      threadId: thread.id,
      actorId: ren.id,
      kind: "select_candidate",
      payload: { proposalVersionId: aV1.id },
    });

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: ren.id,
        kind: "declare_rough",
        payload: { binding: true, summary: "案A採用" },
      }),
    ).rejects.toThrow(InvalidTransition);

    const aV2 = await addProposalVersion(db, {
      proposalId: proposalA.id,
      authorId: ren.id,
      content: "案A v2: フラグ付きロールアウト＋計測",
    });

    await declare(db, {
      threadId: thread.id,
      actorId: ren.id,
      kind: "select_candidate",
      payload: { proposalVersionId: aV2.id },
    });

    await addPost(db, {
      threadId: thread.id,
      authorId: sou.id,
      type: "objection",
      body: "移行時の再インデックス手順が不明",
      rationale: "懸念として記録",
      blocking: false,
      proposalVersionId: aV2.id,
    });

    const decided = await declare(db, {
      threadId: thread.id,
      actorId: ren.id,
      kind: "declare_rough",
      payload: { binding: true, summary: "案A v2 を採用" },
    });
    expect(decided.thread.state).toBe("decided");

    const [agreement] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.threadId, thread.id));
    expect(agreement?.binding).toBe(true);
    expect(agreement?.proposalVersionId).toBe(aV2.id);

    const adopted = await db
      .select()
      .from(proposals)
      .where(
        and(eq(proposals.outcome, "adopted"), eq(proposals.threadId, thread.id)),
      );
    expect(adopted).toHaveLength(1);
    expect(adopted[0]!.number).toBe(1);

    const [bRow] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalB.id));
    expect(bRow?.outcome).toBe("open");

    await expect(
      createThread(db, {
        projectId: project.id,
        ownerId: ren.id,
        type: "proposal",
        target: "repo_artifact",
        title: "矛盾するスレッド",
        trigger: "新しい提案",
        duplicateSearchQuery: "test",
      }),
    ).rejects.toThrow(GateViolation);

    await expect(
      createThread(db, {
        projectId: project.id,
        ownerId: ren.id,
        type: "proposal",
        target: "repo_artifact",
        title: "引用付きスレッド",
        trigger: "上書き提案",
        duplicateSearchQuery: "test",
        conflictCitationsChecked: true,
        conflictCitations: [
          { agreementId: agreement!.id, note: "既存決定を上書き" },
        ],
      }),
    ).resolves.toBeDefined();
  });
});

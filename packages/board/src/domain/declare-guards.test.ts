import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { agreements, events, posts, threads } from "../db/schema.js";
import { declare } from "./declare.js";
import { InvalidTransition, PermissionDenied } from "./errors.js";
import { getMainParticipantIds, getMainParticipants } from "./helpers.js";
import { registerParticipant } from "./participants.js";
import { addProposal } from "./proposals.js";
import { createProject } from "./projects.js";
import { createThread } from "./threads.js";
import { adoptDefaultFounding } from "./founding.js";

/** レビューで見つけた穴の回帰テスト: 失敗した宣言の痕跡、決定済みへの再宣言、完了後の不採用 */
describe("宣言のガード（トランザクションと状態遷移）", () => {
  async function setup(consensusType: "owner_decision" | "rough") {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
      engine: "claude",
    });
    const outsider = await registerParticipant(db, {
      kind: "agent",
      displayName: "ユイ",
      ownerParticipantId: owner.id,
      engine: "opencode",
    });
    const project = await createProject(db, {
      name: `guards-${consensusType}-${Date.now()}-${Math.random()}`,
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "implementation",
      title: "ガード検証",
      trigger: "テスト",
      duplicateSearchQuery: "guards",
      consensusType,
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "案 v1",
    });
    return { owner, agent, outsider, project, thread, version };
  }

  it("失敗した宣言は、宣言投稿もイベントも残さない（ロールバック）", async () => {
    const { outsider, thread, version, project, agent } =
      await setup("owner_decision");

    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });

    // スレッドオーナーでない参加者のオーナー決定 → PermissionDenied
    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: outsider.id,
        kind: "owner_decide",
        payload: { binding: false, summary: "不正な決定" },
      }),
    ).rejects.toThrow(PermissionDenied);

    // 失敗した宣言の declaration 投稿が残っていないこと
    const declarationPosts = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.threadId, thread.id),
          eq(posts.type, "declaration"),
          eq(posts.authorParticipantId, outsider.id),
        ),
      );
    expect(declarationPosts).toHaveLength(0);

    // 失敗した宣言のイベントが残っていないこと
    const declarationEvents = (
      await db.select().from(events).where(eq(events.projectId, project.id))
    ).filter(
      (e) =>
        e.kind === "thread_declaration" &&
        e.actorParticipantId === outsider.id,
    );
    expect(declarationEvents).toHaveLength(0);
  });

  it("決定済みスレッドへの再宣言はできず、合意物が二重記録されない", async () => {
    const { agent, thread, version } = await setup("owner_decision");

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
      payload: { binding: false, summary: "採用" },
    });

    // 2 回目のオーナー決定 → InvalidTransition
    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: agent.id,
        kind: "owner_decide",
        payload: { binding: true, summary: "二重決定" },
      }),
    ).rejects.toThrow(InvalidTransition);

    // 決定済みスレッドでの候補再選定も不可
    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: agent.id,
        kind: "select_candidate",
        payload: { proposalVersionId: version.id },
      }),
    ).rejects.toThrow(InvalidTransition);

    const rows = await db
      .select()
      .from(agreements)
      .where(eq(agreements.threadId, thread.id));
    expect(rows).toHaveLength(1);
  });

  it("完了済みスレッドは不採用にできない", async () => {
    const { agent, thread, version } = await setup("owner_decision");

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
      payload: { binding: false, summary: "採用" },
    });
    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "complete_thread",
      payload: {},
    });

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: agent.id,
        kind: "reject_thread",
        payload: { summary: "やっぱりやめる" },
      }),
    ).rejects.toThrow(InvalidTransition);
  });

  it("成立の宣言には binding と summary が必須", async () => {
    const { agent, thread, version } = await setup("rough");

    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: agent.id,
        kind: "declare_rough",
        payload: { summary: "binding なし" },
      }),
    ).rejects.toThrow(InvalidTransition);

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: agent.id,
        kind: "declare_rough",
        payload: { binding: true },
      }),
    ).rejects.toThrow(InvalidTransition);
  });

  it("候補提案版の著者は自分の版を批准できない（自己批准の禁止）", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: `self-ratify-${Date.now()}-${Math.random()}`,
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      target: "shared_artifact",
      sharedArtifactKind: "project_rule",
      title: "オーナー自身の提案",
      trigger: "テスト",
      duplicateSearchQuery: "self-ratify",
      consensusType: "human_ratification",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: owner.id,
      content: "オーナー自身が書いた案",
    });
    await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });
    await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "request_ratification",
      payload: {},
    });

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: owner.id,
        kind: "ratify",
        payload: { binding: true, summary: "自分で決める" },
      }),
    ).rejects.toThrow(PermissionDenied);
  });

  it("getMainParticipantIds/getMainParticipants はロール割当を持たないプロジェクトオーナーを含む", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "ソウ",
      ownerParticipantId: owner.id,
      engine: "claude",
    });
    const project = await createProject(db, {
      name: `mains-${Date.now()}-${Math.random()}`,
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "implementation",
      title: "主な参加者テスト",
      trigger: "テスト",
      duplicateSearchQuery: "主な参加者",
      consensusType: "owner_decision",
      conflictCitationsChecked: true,
    });

    const ids = await getMainParticipantIds(db, thread.id);
    expect(ids).toContain(owner.id);
    expect(ids).toContain(agent.id);

    const mains = await getMainParticipants(db, thread.id);
    expect(mains.map((m) => m.id).sort()).toEqual([owner.id, agent.id].sort());
    expect(mains.find((m) => m.id === owner.id)?.kind).toBe("human");
  });

  it("extend_window はスレッドオーナーが期限を延長できる", async () => {
    const { agent, thread, version } = await setup("owner_decision");
    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });
    await db
      .update(threads)
      .set({
        awaitingEnteredAt: new Date("2026-08-01T00:00:00Z"),
        timingDurationHours: 24,
        timingEndsAt: new Date("2026-08-02T00:00:00Z"),
      })
      .where(eq(threads.id, thread.id));

    const result = await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "extend_window",
      payload: { hours: 48 },
    });
    expect(result.thread.timingDurationHours).toBe(48);
    expect(result.thread.timingEndsAt?.toISOString()).toBe(
      new Date("2026-08-03T00:00:00Z").toISOString(),
    );
  });

  it("shorten_window はプロジェクトオーナーのみでき、現在の期限より手前にする必要がある", async () => {
    const { agent, outsider, owner, thread, version } = await setup("owner_decision");
    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });
    await db
      .update(threads)
      .set({
        awaitingEnteredAt: new Date("2026-08-01T00:00:00Z"),
        timingDurationHours: 48,
        timingEndsAt: new Date("2026-08-03T00:00:00Z"),
      })
      .where(eq(threads.id, thread.id));

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: outsider.id,
        kind: "shorten_window",
        payload: { hours: 12 },
      }),
    ).rejects.toThrow(PermissionDenied);

    await expect(
      declare(db, {
        threadId: thread.id,
        actorId: owner.id,
        kind: "shorten_window",
        payload: { hours: 72 },
      }),
    ).rejects.toThrow(InvalidTransition);

    const result = await declare(db, {
      threadId: thread.id,
      actorId: owner.id,
      kind: "shorten_window",
      payload: { hours: 12 },
    });
    expect(result.thread.timingDurationHours).toBe(12);
  });
});

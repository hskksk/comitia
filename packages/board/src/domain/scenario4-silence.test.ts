import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { posts, threads } from "../db/schema.js";
import { bootstrapBoard, registerAgent } from "./bootstrap.js";
import { declare } from "./declare.js";
import { getSystemParticipant } from "./participants.js";
import { addProposal } from "./proposals.js";
import { openOrGetSession } from "./sessions.js";
import { createThread } from "./threads.js";
import { adoptDefaultFounding } from "./founding.js";
import { evaluateTimedConsensus } from "./timed-consensus.js";

describe("シナリオ4: 沈黙期限", () => {
  it("全員睡眠のあいだは成立せず、エージェントが起きて窓が過ぎるとシステム宣言で decided になる", async () => {
    const { owner, project } = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia-web",
    });
    const { agent: sou } = await registerAgent(db, {
      ownerParticipantId: owner.id,
      displayName: "ソウ",
      engine: "claude-code",
    });
    const { agent: mika } = await registerAgent(db, {
      ownerParticipantId: owner.id,
      displayName: "ミカ",
      engine: "claude-code",
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: sou.id,
      type: "implementation",
      title: "沈黙期限で決める",
      trigger: "テスト",
      duplicateSearchQuery: "沈黙期限",
      consensusType: "silence",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: sou.id,
      content: "沈黙で決める案",
    });
    await declare(db, {
      threadId: thread.id,
      actorId: sou.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });

    const t0 = new Date("2026-08-01T00:00:00Z");
    const timingEndsAt = new Date(t0.getTime() + 48 * 3600_000);
    await db
      .update(threads)
      .set({ awaitingEnteredAt: t0, timingDurationHours: 48, timingEndsAt })
      .where(eq(threads.id, thread.id));

    const past48h = new Date(timingEndsAt.getTime() + 3600_000);

    await evaluateTimedConsensus(db, { now: past48h });
    const [stillAwaiting] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, thread.id));
    expect(stillAwaiting?.state).toBe("awaiting_decision");

    await openOrGetSession(db, { participantId: sou.id, projectId: project.id });
    await openOrGetSession(db, { participantId: mika.id, projectId: project.id });

    await evaluateTimedConsensus(db, { now: past48h });

    const [decided] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, thread.id));
    expect(decided?.state).toBe("decided");

    const system = await getSystemParticipant(db);
    const [declarationPost] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.threadId, thread.id),
          eq(posts.declarationKind, "clock_satisfy"),
        ),
      );
    expect(declarationPost?.authorParticipantId).toBe(system.id);
  });

  it("非システム参加者が clock_satisfy を直接呼ぶと拒否される", async () => {
    const { owner, project } = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia-web",
    });
    const { agent: sou } = await registerAgent(db, {
      ownerParticipantId: owner.id,
      displayName: "ソウ",
      engine: "claude-code",
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: sou.id,
      type: "implementation",
      title: "直接呼び出し拒否",
      trigger: "テスト",
      duplicateSearchQuery: "直接呼び出し",
      consensusType: "silence",
      conflictCitationsChecked: true,
    });
    const { version } = await addProposal(db, {
      threadId: thread.id,
      authorId: sou.id,
      content: "案",
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
        kind: "clock_satisfy",
        payload: { binding: false, summary: "不正な直接呼び出し" },
      }),
    ).rejects.toThrow();
  });
});

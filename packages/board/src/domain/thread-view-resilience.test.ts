import "../test/helpers.js";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { participants, proposals, proposalVersions } from "../db/schema.js";
import { bootstrapBoard } from "./bootstrap.js";
import { getHumanThreadView } from "./human-views.js";
import { addProposal } from "./proposals.js";
import { createThread } from "./threads.js";

async function seedThread(projectId: string, agentId: string, title: string) {
  return createThread(db, {
    projectId,
    ownerId: agentId,
    type: "implementation",
    title,
    trigger: "テスト",
    duplicateSearchQuery: title,
    consensusType: "owner_decision",
    conflictCitationsChecked: true,
  });
}

describe("問題 A: 版を持たない提案行があってもスレッド画面が落ちない", () => {
  it("対照: 版のある提案は今までどおり一覧に出る", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const thread = await seedThread(project.id, agent.id, "対照");
    await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "健全な提案",
    });

    const view = await getHumanThreadView(db, thread.id);
    expect(view.proposals).toHaveLength(1);
    expect(view.proposals[0]!.content).toBe("健全な提案");
  });

  it("版を失った提案行があっても 500 にならず、健全な提案は残る", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const thread = await seedThread(project.id, agent.id, "壊れた行あり");
    const broken = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "版が消える提案",
    });
    const healthy = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "健全な提案",
    });
    // 本番で起きている状態（版を 1 件も持たない提案行）を作る
    await db
      .delete(proposalVersions)
      .where(eq(proposalVersions.proposalId, broken.proposal.id));

    const view = await getHumanThreadView(db, thread.id);
    expect(view.proposals.map((row) => row.id)).toEqual([healthy.proposal.id]);
    expect(view.proposals[0]!.content).toBe("健全な提案");
  });

  it("addProposal は不可分。版の insert が落ちたら提案行も残らない", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const thread = await seedThread(project.id, agent.id, "巻き戻し");
    await expect(
      addProposal(db, {
        threadId: thread.id,
        authorId: agent.id,
        // content は notNull。2 本目の insert がここで落ちる
        content: null as unknown as string,
      }),
    ).rejects.toThrow();

    const rows = await db
      .select()
      .from(proposals)
      .where(eq(proposals.threadId, thread.id));
    expect(rows).toHaveLength(0);
  });
});

describe("問題 B: システム参加者の行", () => {
  it("bootstrap は 1 行だけ作り、二重に作らない", async () => {
    await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const rows = await db
      .select()
      .from(participants)
      .where(eq(participants.kind, "system"));
    expect(rows).toHaveLength(1);
  });

  it("0015 の補填 SQL は、参加者が居てシステム行が無い DB だけを直す（再実行しても増えない）", async () => {
    // bootstrap を経ていない既存 DB を模す（参加者は居るが system は居ない）
    await seedOwnerAgentProject(db);
    const before = await db
      .select()
      .from(participants)
      .where(eq(participants.kind, "system"));
    expect(before).toHaveLength(0);

    const backfill = sql`
      INSERT INTO "participants" ("kind", "display_name")
      SELECT 'system', 'Comitia'
      WHERE EXISTS (SELECT 1 FROM "participants")
        AND NOT EXISTS (SELECT 1 FROM "participants" WHERE "kind" = 'system')
    `;
    await db.execute(backfill);
    const after = await db
      .select()
      .from(participants)
      .where(eq(participants.kind, "system"));
    expect(after).toHaveLength(1);

    await db.execute(backfill);
    const again = await db
      .select()
      .from(participants)
      .where(
        and(eq(participants.kind, "system"), eq(participants.displayName, "Comitia")),
      );
    expect(again).toHaveLength(1);
  });
});

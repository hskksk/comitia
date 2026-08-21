import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { workClaims } from "../db/schema.js";
import { createBoardMcpServer } from "../mcp/create-server.js";
import { registerParticipant } from "../domain/participants.js";
import { createProject } from "../domain/projects.js";
import { addMembership } from "../domain/memberships.js";
import { adoptDefaultFounding } from "../domain/founding.js";

describe("MCP scenario 1 minimal path", () => {
  it("get_briefing → set_goals → search_threads → create_thread → add_proposal → claim_work → post → end_session", async () => {
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
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    await addMembership(db, {
      projectId: project.id,
      participantId: sou.id,
      actorId: owner.id,
    });

    const { callTool, parseJsonContent } = createBoardMcpServer({
      db,
      participantId: sou.id,
      projectId: project.id,
    });

    const briefing = parseJsonContent(await callTool("get_briefing"));
    expect(typeof briefing.remaining_budget).toBe("number");
    expect(String(briefing.rules)).toContain("プロジェクトルール");

    const goals = parseJsonContent(
      await callTool("set_goals", {
        goals: ["README typo を 1 件直す"],
      }),
    );
    expect(goals.ok).toBe(true);

    const search = parseJsonContent(await callTool("search_threads", {}));
    expect(Array.isArray(search.threads)).toBe(true);

    const created = parseJsonContent(
      await callTool("create_thread", {
        type: "implementation",
        title: "README typo 修正",
        trigger: "docs/README.md の Comittia 表記ゆれを発見",
        duplicateSearchQuery: "typo README Comittia",
        consensusType: "owner_decision",
        conflictCitationsChecked: true,
      }),
    );
    const threadId = created.thread_id as string;

    const proposal = parseJsonContent(
      await callTool("add_proposal", {
        thread_id: threadId,
        content: "Comittia → Comitia（3箇所）",
      }),
    );
    expect(proposal.proposal_version_id).toBeTruthy();

    const claimed = parseJsonContent(
      await callTool("claim_work", {
        thread_id: threadId,
        paths: ["docs/README.md"],
      }),
    );
    expect(claimed.claim_id).toBeTruthy();

    const [claimRow] = await db
      .select()
      .from(workClaims)
      .where(eq(workClaims.threadId, threadId));
    expect(claimRow).toBeTruthy();
    expect(claimRow?.active).toBe(true);

    const report = parseJsonContent(
      await callTool("post", {
        thread_id: threadId,
        type: "report",
        body: "修正完了",
      }),
    );
    expect(report.post_id).toBeTruthy();

    const ended = parseJsonContent(
      await callTool("end_session", {
        handover: "README typo を修正し report で報告した",
      }),
    );
    expect(ended.ok).toBe(true);
  });
});

import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { agreements } from "../db/schema.js";
import { addProposal } from "./proposals.js";
import { getBriefing } from "./briefing.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";
import { assignRole } from "./roles.js";
import { createThread } from "./threads.js";

async function setupParticipants() {
  const owner = await registerParticipant(db, {
    kind: "human",
    displayName: "ハル",
  });
  const agent = await registerParticipant(db, {
    kind: "agent",
    displayName: "ソウ",
    ownerParticipantId: owner.id,
    engine: "claude-code",
  });
  const project = await createProject(db, {
    name: "comitia-web",
    ownerParticipantId: owner.id,
    repoUrl: "https://github.com/hskksk/comitia",
  });
  return { owner, agent, project };
}

async function insertBindingAgreement(input: {
  projectId: string;
  ownerId: string;
  summary: string;
}) {
  const thread = await createThread(db, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    type: "proposal",
    title: "ルール",
    trigger: "テスト用の拘束的決定",
    duplicateSearchQuery: "rule",
    target: "repo_artifact",
  });
  const { version } = await addProposal(db, {
    threadId: thread.id,
    authorId: input.ownerId,
    content: "案",
  });
  const [agreement] = await db
    .insert(agreements)
    .values({
      projectId: input.projectId,
      threadId: thread.id,
      proposalVersionId: version.id,
      outcome: "adopted",
      binding: true,
      summary: input.summary,
    })
    .returning();
  return { thread, agreement: agreement! };
}

describe("getBriefing (M7-1 material)", () => {
  it("returns who-am-I, where, and the open field even with zero owned threads", async () => {
    const { agent, project } = await setupParticipants();

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(briefing.you).toEqual({
      displayName: "ソウ",
      roles: [],
      engine: "claude-code",
    });
    expect(briefing.project).toEqual({
      name: "comitia-web",
      repoUrl: "https://github.com/hskksk/comitia",
      githubOwner: null,
      githubRepo: null,
    });
    expect(briefing.situation.threads).toEqual([]);
    expect(briefing.situation.open_threads).toEqual([]);
    expect(briefing.situation.participants.map((p) => p.displayName)).toEqual(
      expect.arrayContaining(["ハル", "ソウ"]),
    );
  });

  it("rules is empty and the conflict-citation gate is off with zero binding agreements", async () => {
    const { agent, project } = await setupParticipants();

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(briefing.rules).toBe("");
    expect(briefing.situation.gates).toEqual({
      conflict_citations_required: false,
    });
  });

  it("surfaces a binding agreement's summary and arms the conflict-citation gate", async () => {
    const { owner, agent, project } = await setupParticipants();
    await insertBindingAgreement({
      projectId: project.id,
      ownerId: owner.id,
      summary: "レビューは2人以上の承認が必要",
    });

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(briefing.rules).toContain("レビューは2人以上の承認が必要");
    expect(briefing.situation.gates).toEqual({
      conflict_citations_required: true,
    });
  });

  it("shows a project-wide open thread even when the agent owns none of it", async () => {
    const { owner, agent, project } = await setupParticipants();
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "consultation",
      title: "オーナーが立てた相談",
      trigger: "きっかけ",
      duplicateSearchQuery: "owner thread",
    });

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(briefing.situation.threads).toEqual([]);
    expect(briefing.situation.open_threads).toEqual([
      { id: thread.id, title: "オーナーが立てた相談", type: "consultation", state: "discussing" },
    ]);
  });

  it("reflects an assigned role in you.roles", async () => {
    const { owner, agent, project } = await setupParticipants();
    await assignRole(db, {
      projectId: project.id,
      participantId: agent.id,
      role: "proposer",
      actorId: owner.id,
    });

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(briefing.you.roles).toEqual(["proposer"]);
  });

  it("keeps get_briefing activity cost at 0 (unchanged budget)", async () => {
    const { agent, project } = await setupParticipants();

    const first = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    const second = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });

    expect(second.remaining_budget).toBe(first.remaining_budget);
  });
});

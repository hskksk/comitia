import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { EventKind } from "@comitia/shared";
import { EVENT_KINDS } from "@comitia/shared";
import { db } from "../test/helpers.js";
import { events } from "../db/schema.js";
import { supersedeAgreement } from "./agreements.js";
import { declare } from "./declare.js";
import { registerParticipant } from "./participants.js";
import { addPost, resolveObjection } from "./posts.js";
import { addProposal, addProposalVersion } from "./proposals.js";
import { createProject } from "./projects.js";
import { assignRole } from "./roles.js";
import { createThread } from "./threads.js";
import { adoptDefaultFounding } from "./founding.js";

describe("イベント記録", () => {
  it("主要操作がイベントに残る", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "レン",
      ownerParticipantId: owner.id,
      engine: "claude",
    });

    const project = await createProject(db, {
      name: "p",
      ownerParticipantId: owner.id,
    });
    await adoptDefaultFounding(db, {
      projectId: project.id,
      ownerId: owner.id,
    });

    await assignRole(db, {
      projectId: project.id,
      participantId: agent.id,
      role: "proposer",
      actorId: owner.id,
    });

    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: agent.id,
      type: "proposal",
      target: "repo_artifact",
      title: "t",
      trigger: "きっかけ",
      duplicateSearchQuery: "q",
      consensusType: "rough",
      conflictCitationsChecked: true,
    });

    const { proposal, version } = await addProposal(db, {
      threadId: thread.id,
      authorId: agent.id,
      content: "案",
    });

    await addProposalVersion(db, {
      proposalId: proposal.id,
      authorId: agent.id,
      content: "案 v2",
    });

    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "select_candidate",
      payload: { proposalVersionId: version.id },
    });

    const objection = await addPost(db, {
      threadId: thread.id,
      authorId: owner.id,
      type: "objection",
      body: "懸念",
      rationale: "リスクあり",
      blocking: true,
      proposalVersionId: version.id,
    });

    await resolveObjection(db, {
      postId: objection.id,
      actorId: agent.id,
      note: "提案の修正で解消した",
    });

    await declare(db, {
      threadId: thread.id,
      actorId: agent.id,
      kind: "declare_rough",
      payload: { binding: false, summary: "採用" },
    });

    const allEvents = await db
      .select()
      .from(events)
      .where(eq(events.projectId, project.id));

    const kinds = new Set(allEvents.map((e) => e.kind));

    const expected: EventKind[] = [
      "project_created",
      "role_assigned",
      "thread_created",
      "proposal_added",
      "proposal_version_added",
      "thread_declaration",
      "candidate_selected",
      "post_added",
      "objection_resolved",
      "state_changed",
      "agreement_recorded",
    ];

    for (const kind of expected) {
      expect(kinds.has(kind), `イベント ${kind} が記録されていること`).toBe(
        true,
      );
    }

    // participant_registered は projectId なしで記録
    const globalEvents = await db.select().from(events);
    expect(
      globalEvents.some((e) => e.kind === "participant_registered"),
    ).toBe(true);

    // agreement_superseded の検証
    const [agreement] = await db
      .select()
      .from(events)
      .where(eq(events.kind, "agreement_recorded"));
    const agreementId = (agreement?.payload as { agreementId: string })
      .agreementId;

    const { agreements } = await import("../db/schema.js");
    const [newAgreement] = await db
      .insert(agreements)
      .values({
        projectId: project.id,
        threadId: thread.id,
        proposalVersionId: version.id,
        outcome: "adopted",
        binding: true,
        summary: "置換先",
      })
      .returning();

    await supersedeAgreement(db, {
      agreementId,
      byAgreementId: newAgreement!.id,
      actorId: owner.id,
    });

    const afterSupersede = await db.select().from(events);
    expect(
      afterSupersede.some((e) => e.kind === "agreement_superseded"),
    ).toBe(true);

    // EVENT_KINDS の網羅（proposal_version_added は別操作で確認）
    expect(EVENT_KINDS.length).toBeGreaterThan(0);
  });
});

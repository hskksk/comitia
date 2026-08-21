import { eq } from "drizzle-orm";
import type { SystemTemplateKind } from "../catalog/index.js";
import { resolveTemplateContent } from "../catalog/index.js";
import { agreements, proposals, threads } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation } from "./errors.js";
import { addProposal } from "./proposals.js";
import { createThread } from "./threads.js";
import {
  getProjectSetup,
  type ConstitutionKind,
  hasActiveSharedArtifact,
} from "./constitution.js";

const FOUNDING_TITLES: Record<ConstitutionKind, string> = {
  project_rule: "プロジェクトルール（創設）",
  thread_template: "スレッドテンプレ（創設）",
};

export async function adoptFoundingArtifact(
  db: Db,
  input: {
    projectId: string;
    ownerId: string;
    kind: ConstitutionKind;
    content: string;
    title?: string;
    summary?: string;
  },
) {
  if (await hasActiveSharedArtifact(db, input.projectId, input.kind)) {
    throw new GateViolation(
      input.kind === "project_rule"
        ? "プロジェクトルールはすでに決まっています。改正は提案スレッドで行ってください"
        : "スレッドテンプレはすでに決まっています。改正は提案スレッドで行ってください",
    );
  }

  const title = input.title ?? FOUNDING_TITLES[input.kind];
  const thread = await createThread(db, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    type: "proposal",
    target: "shared_artifact",
    sharedArtifactKind: input.kind,
    title,
    trigger: "プロジェクト創設時の指定",
    duplicateSearchQuery: input.kind,
    conflictCitationsChecked: true,
  });
  const { proposal, version } = await addProposal(db, {
    threadId: thread.id,
    authorId: input.ownerId,
    content: input.content,
  });

  const now = new Date();
  await db
    .update(threads)
    .set({
      candidateProposalVersionId: version.id,
      state: "decided",
      decidedAt: now,
    })
    .where(eq(threads.id, thread.id));
  await db
    .update(proposals)
    .set({ outcome: "adopted" })
    .where(eq(proposals.id, proposal.id));

  const summary = input.summary ?? title;
  const [agreement] = await db
    .insert(agreements)
    .values({
      projectId: input.projectId,
      threadId: thread.id,
      proposalVersionId: version.id,
      outcome: "adopted",
      binding: true,
      state: "active",
      summary,
    })
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    threadId: thread.id,
    actorParticipantId: input.ownerId,
    kind: "state_changed",
    payload: {
      from: "discussing",
      to: "decided",
      reason: "創設時の採用",
    },
  });
  await recordEvent(db, {
    projectId: input.projectId,
    threadId: thread.id,
    actorParticipantId: input.ownerId,
    kind: "agreement_recorded",
    payload: {
      agreementId: agreement!.id,
      outcome: "adopted",
      binding: true,
      proposalVersionId: version.id,
    },
  });

  return { thread, proposal, version, agreement: agreement! };
}

export async function adoptFoundingFromInput(
  db: Db,
  input: {
    projectId: string;
    ownerId: string;
    kind: SystemTemplateKind;
    templateId?: string;
    content?: string;
  },
) {
  const content = resolveTemplateContent({
    kind: input.kind,
    templateId: input.templateId,
    content: input.content,
  });
  return adoptFoundingArtifact(db, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    kind: input.kind,
    content,
  });
}

export async function adoptDefaultFounding(
  db: Db,
  input: { projectId: string; ownerId: string },
) {
  const setup = await getProjectSetup(db, input.projectId);
  if (!setup.projectRule) {
    await adoptFoundingFromInput(db, {
      projectId: input.projectId,
      ownerId: input.ownerId,
      kind: "project_rule",
      templateId: "default",
    });
  }
  if (!setup.threadTemplate) {
    await adoptFoundingFromInput(db, {
      projectId: input.projectId,
      ownerId: input.ownerId,
      kind: "thread_template",
      templateId: "default",
    });
  }
}

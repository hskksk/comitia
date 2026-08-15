import { desc, eq } from "drizzle-orm";
import { proposals, proposalVersions } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation } from "./errors.js";
import { getThreadRow } from "./helpers.js";

export async function addProposal(
  db: Db,
  input: {
    threadId: string;
    authorId: string;
    content: string;
  },
) {
  const thread = await getThreadRow(db, input.threadId);
  if (thread.type === "brainstorm") {
    throw new GateViolation("ブレストスレッドには提案を出せません");
  }

  const existing = await db
    .select({ number: proposals.number })
    .from(proposals)
    .where(eq(proposals.threadId, input.threadId))
    .orderBy(desc(proposals.number))
    .limit(1);

  const nextNumber = (existing[0]?.number ?? 0) + 1;

  const [proposal] = await db
    .insert(proposals)
    .values({
      threadId: input.threadId,
      number: nextNumber,
      authorParticipantId: input.authorId,
    })
    .returning();

  const [version] = await db
    .insert(proposalVersions)
    .values({
      proposalId: proposal!.id,
      versionNumber: 1,
      content: input.content,
    })
    .returning();

  await recordEvent(db, {
    projectId: thread.projectId,
    threadId: input.threadId,
    actorParticipantId: input.authorId,
    kind: "proposal_added",
    payload: {
      proposalId: proposal!.id,
      proposalVersionId: version!.id,
      number: nextNumber,
    },
  });

  return { proposal: proposal!, version: version! };
}

export async function addProposalVersion(
  db: Db,
  input: {
    proposalId: string;
    authorId: string;
    content: string;
  },
) {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, input.proposalId));
  if (!proposal) {
    throw new GateViolation("提案が見つかりません");
  }

  const thread = await getThreadRow(db, proposal.threadId);

  const existing = await db
    .select({ versionNumber: proposalVersions.versionNumber })
    .from(proposalVersions)
    .where(eq(proposalVersions.proposalId, input.proposalId))
    .orderBy(desc(proposalVersions.versionNumber))
    .limit(1);

  const nextVersion = (existing[0]?.versionNumber ?? 0) + 1;

  const [version] = await db
    .insert(proposalVersions)
    .values({
      proposalId: input.proposalId,
      versionNumber: nextVersion,
      content: input.content,
    })
    .returning();

  await recordEvent(db, {
    projectId: thread.projectId,
    threadId: proposal.threadId,
    actorParticipantId: input.authorId,
    kind: "proposal_version_added",
    payload: {
      proposalId: input.proposalId,
      proposalVersionId: version!.id,
      versionNumber: nextVersion,
    },
  });

  return version!;
}

import { formatParticipantLabel } from "@comitia/shared";
import { asc, desc, eq, and, inArray } from "drizzle-orm";
import { participants, posts, proposalVersions } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { getDecisionView } from "./decision-view.js";
import { getThreadRow } from "./helpers.js";
import { listThreadProposals } from "./human-views.js";
import { listThreadPullRequests } from "./pull-requests.js";
import { listActiveThreadClaims } from "./work-claims.js";
import { deriveWorkPhase } from "./work-phase.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function readThread(db: Db, threadId: string) {
  const thread = await getThreadRow(db, threadId);

  const [latestSynthesis] = await db
    .select({
      id: posts.id,
      body: posts.body,
      authorParticipantId: posts.authorParticipantId,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(eq(posts.threadId, threadId), eq(posts.type, "synthesis")))
    .orderBy(desc(posts.createdAt))
    .limit(1);

  let candidateProposal: {
    id: string;
    proposalId: string;
    versionNumber: number;
    content: string;
  } | null = null;

  if (thread.candidateProposalVersionId) {
    const [version] = await db
      .select()
      .from(proposalVersions)
      .where(eq(proposalVersions.id, thread.candidateProposalVersionId));
    if (version) {
      candidateProposal = {
        id: version.id,
        proposalId: version.proposalId,
        versionNumber: version.versionNumber,
        content: version.content,
      };
    }
  }

  const [pullRequests, workClaims, proposals] = await Promise.all([
    listThreadPullRequests(db, threadId),
    listActiveThreadClaims(db, threadId),
    listThreadProposals(db, threadId),
  ]);

  const threadPosts = await db
    .select({
      id: posts.id,
      type: posts.type,
      body: posts.body,
      rationale: posts.rationale,
      authorParticipantId: posts.authorParticipantId,
      authorDisplayName: participants.displayName,
      authorKind: participants.kind,
      authorOwnerParticipantId: participants.ownerParticipantId,
      proposalVersionId: posts.proposalVersionId,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(participants, eq(posts.authorParticipantId, participants.id))
    .where(eq(posts.threadId, threadId))
    .orderBy(asc(posts.createdAt));

  const ownerIds = [
    ...new Set(
      threadPosts
        .filter((post) => post.authorKind === "agent" && post.authorOwnerParticipantId)
        .map((post) => post.authorOwnerParticipantId!),
    ),
  ];
  const ownerRows =
    ownerIds.length === 0
      ? []
      : await db
          .select({ id: participants.id, displayName: participants.displayName })
          .from(participants)
          .where(inArray(participants.id, ownerIds));
  const ownerNameById = new Map(ownerRows.map((row) => [row.id, row.displayName]));

  return {
    thread_id: thread.id,
    thread: {
      title: thread.title,
      type: thread.type,
      state: thread.state,
      workPhase: deriveWorkPhase({
        threadType: thread.type,
        threadState: thread.state,
        hasActiveClaim: workClaims.length > 0,
        pullRequestStates: pullRequests.map((pr) => pr.state),
      }),
      target: thread.target,
      sharedArtifactKind: thread.sharedArtifactKind,
      consensusType: thread.consensusType,
      humanRequired: thread.humanRequired,
      ownerParticipantId: thread.ownerParticipantId,
      awaitingEnteredAt: iso(thread.awaitingEnteredAt),
      timingEndsAt: iso(thread.timingEndsAt),
    },
    synthesis: latestSynthesis
      ? {
          id: latestSynthesis.id,
          body: latestSynthesis.body,
          authorParticipantId: latestSynthesis.authorParticipantId,
          createdAt: latestSynthesis.createdAt.toISOString(),
        }
      : null,
    candidate_proposal: candidateProposal,
    proposals,
    pullRequests,
    workClaims,
    posts: threadPosts.map((post) => ({
      id: post.id,
      type: post.type,
      body: post.body,
      rationale: post.rationale,
      authorParticipantId: post.authorParticipantId,
      authorDisplayName: formatParticipantLabel({
        kind: post.authorKind,
        displayName: post.authorDisplayName,
        ownerDisplayName: post.authorOwnerParticipantId
          ? ownerNameById.get(post.authorOwnerParticipantId)
          : undefined,
      }),
      proposalVersionId: post.proposalVersionId,
      createdAt: post.createdAt.toISOString(),
    })),
    decision_view: await getDecisionView(db, threadId),
  };
}

import { asc, desc, eq, and } from "drizzle-orm";
import { posts, proposalVersions } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { getDecisionView } from "./decision-view.js";
import { getThreadRow } from "./helpers.js";

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

  const threadPosts = await db
    .select({
      id: posts.id,
      type: posts.type,
      body: posts.body,
      rationale: posts.rationale,
      authorParticipantId: posts.authorParticipantId,
      proposalVersionId: posts.proposalVersionId,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(eq(posts.threadId, threadId))
    .orderBy(asc(posts.createdAt));

  return {
    thread_id: thread.id,
    thread: {
      title: thread.title,
      type: thread.type,
      state: thread.state,
    },
    synthesis: latestSynthesis ?? null,
    candidate_proposal: candidateProposal,
    posts: threadPosts,
    decision_view: await getDecisionView(db, threadId),
  };
}

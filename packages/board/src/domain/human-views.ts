import { formatParticipantLabel } from "@comitia/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ConsensusType, PullRequestState, SharedArtifactKind, ThreadType, WorkPhase } from "@comitia/shared";
import {
  events,
  participants,
  posts,
  proposals,
  proposalVersions,
  threads,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { NotFoundError } from "./errors.js";
import { evaluateConsensus } from "./consensus.js";
import { getDecisionView, type DecisionView } from "./decision-view.js";
import { getMainParticipants, getThreadRow } from "./helpers.js";
import { getThreadApprovals, getThreadObjections } from "./posts.js";
import { listProjectPullRequestsForThreads, listThreadPullRequests } from "./pull-requests.js";
import { listParticipantsWithSessionSince } from "./sessions.js";
import {
  activeClaimantsByThreadId,
  listActiveProjectClaims,
  listActiveThreadClaims,
  type ThreadWorkClaim,
} from "./work-claims.js";
import { deriveWorkPhase } from "./work-phase.js";

export type JudgmentQueueItem = {
  threadId: string;
  title: string;
  type: ThreadType;
  state: "awaiting_decision";
  consensusType: ConsensusType | null;
  humanRequired: boolean;
  enteredAt: string;
  synthesis: { id: string; body: string; createdAt: string } | null;
  candidateProposal: {
    id: string;
    versionNumber: number;
    content: string;
  } | null;
  activeWorkClaimants: string[];
};

export type PullRequestRow = {
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
};

export type NonblockingInboxItem = {
  threadId: string;
  title: string;
  type: ThreadType;
  kind: "merge_wait" | "post_review";
  workPhase: WorkPhase | null;
  decidedAt: string;
  latestReport: { id: string; body: string; createdAt: string } | null;
  pullRequests: PullRequestRow[];
};

export type HumanThreadPost = {
  id: string;
  type: string;
  body: string;
  rationale: string | null;
  authorParticipantId: string;
  authorDisplayName: string;
  createdAt: string;
};

export type HumanProposal = {
  id: string;
  number: number;
  latestVersionId: string;
  versionNumber: number;
  content: string;
};

export type HumanThreadView = {
  thread: {
    id: string;
    projectId: string;
    title: string;
    type: ThreadType;
    state: string;
    consensusType: ConsensusType | null;
    humanRequired: boolean;
    ownerParticipantId: string;
    awaitingEnteredAt: string | null;
    timingEndsAt: string | null;
    target: "repo_artifact" | "shared_artifact" | null;
    sharedArtifactKind: SharedArtifactKind | null;
    workPhase: WorkPhase | null;
  };
  consensusReasons: string[];
  synthesis: { id: string; body: string; createdAt: string } | null;
  candidateProposal: {
    id: string;
    versionNumber: number;
    content: string;
  } | null;
  proposals: HumanProposal[];
  posts: HumanThreadPost[];
  pullRequests: PullRequestRow[];
  workClaims: ThreadWorkClaim[];
  decisionView: DecisionView | null;
};

async function latestSynthesis(db: Db, threadId: string) {
  const [row] = await db
    .select({
      id: posts.id,
      body: posts.body,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(eq(posts.threadId, threadId), eq(posts.type, "synthesis")))
    .orderBy(desc(posts.createdAt))
    .limit(1);
  return row
    ? { id: row.id, body: row.body, createdAt: row.createdAt.toISOString() }
    : null;
}

async function candidateOf(db: Db, proposalVersionId: string | null) {
  if (!proposalVersionId) {
    return null;
  }
  const [version] = await db
    .select()
    .from(proposalVersions)
    .where(eq(proposalVersions.id, proposalVersionId));
  if (!version) {
    return null;
  }
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    content: version.content,
  };
}

async function queueEnteredAt(db: Db, threadId: string, fallback: Date) {
  const [row] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.kind, "state_changed"),
        sql`${events.payload}->>'to' = 'awaiting_decision'`,
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(1);
  return (row?.createdAt ?? fallback).toISOString();
}

async function shouldQueueThread(
  db: Db,
  thread: typeof threads.$inferSelect,
): Promise<boolean> {
  if (thread.consensusType === "human_ratification") {
    return true;
  }
  if (thread.humanRequired) {
    return true;
  }
  if (thread.consensusType === "unanimous" && thread.candidateProposalVersionId) {
    const mains = await getMainParticipants(db, thread.id);
    const approvals = await getThreadApprovals(db, thread.id);
    const approvedByParticipant = new Set(
      approvals
        .filter((a) => a.proposalVersionId === thread.candidateProposalVersionId)
        .map((a) => a.authorParticipantId),
    );
    return mains.some(
      (p) => p.kind === "human" && !approvedByParticipant.has(p.id),
    );
  }
  return false;
}

export async function listJudgmentQueue(
  db: Db,
  input: { projectId: string },
): Promise<JudgmentQueueItem[]> {
  const [rows, activeClaims] = await Promise.all([
    db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.projectId, input.projectId),
          eq(threads.state, "awaiting_decision"),
          isNull(threads.archivedAt),
        ),
      ),
    listActiveProjectClaims(db, input.projectId),
  ]);
  const claimantsByThread = activeClaimantsByThreadId(activeClaims);

  const queued = await Promise.all(
    rows.map(async (thread) => ({
      thread,
      include: await shouldQueueThread(db, thread),
    })),
  );

  const items = await Promise.all(
    queued
      .filter((row) => row.include)
      .map(async ({ thread }) => ({
        threadId: thread.id,
        title: thread.title,
        type: thread.type,
        state: "awaiting_decision" as const,
        consensusType: thread.consensusType,
        humanRequired: thread.humanRequired,
        enteredAt: await queueEnteredAt(db, thread.id, thread.createdAt),
        synthesis: await latestSynthesis(db, thread.id),
        candidateProposal: await candidateOf(
          db,
          thread.candidateProposalVersionId,
        ),
        activeWorkClaimants: claimantsByThread.get(thread.id) ?? [],
      })),
  );

  return items.sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
}

export async function listNonblockingInbox(
  db: Db,
  input: { projectId: string },
): Promise<NonblockingInboxItem[]> {
  const [rows, activeClaims] = await Promise.all([
    db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.projectId, input.projectId),
          eq(threads.state, "decided"),
          inArray(threads.type, ["implementation", "review"]),
          isNull(threads.archivedAt),
        ),
      )
      .orderBy(asc(threads.decidedAt)),
    listActiveProjectClaims(db, input.projectId),
  ]);

  const claimantsByThread = activeClaimantsByThreadId(activeClaims);
  const prByThread = await listProjectPullRequestsForThreads(
    db,
    rows.map((thread) => thread.id),
  );

  return Promise.all(
    rows.map(async (thread) => {
      const pullRequests = prByThread.get(thread.id) ?? [];
      const [report] = await db
        .select({
          id: posts.id,
          body: posts.body,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(and(eq(posts.threadId, thread.id), eq(posts.type, "report")))
        .orderBy(desc(posts.createdAt))
        .limit(1);
      return {
        threadId: thread.id,
        title: thread.title,
        type: thread.type,
        kind: report ? ("post_review" as const) : ("merge_wait" as const),
        workPhase: deriveWorkPhase({
          threadType: thread.type,
          threadState: thread.state,
          hasActiveClaim: (claimantsByThread.get(thread.id)?.length ?? 0) > 0,
          pullRequestStates: pullRequests.map((pr) => pr.state),
        }),
        decidedAt: (thread.decidedAt ?? thread.createdAt).toISOString(),
        latestReport: report
          ? {
              id: report.id,
              body: report.body,
              createdAt: report.createdAt.toISOString(),
            }
          : null,
        pullRequests,
      };
    }),
  );
}

async function consensusReasonsOf(
  db: Db,
  thread: typeof threads.$inferSelect,
): Promise<string[]> {
  if (
    thread.state !== "awaiting_decision" ||
    !thread.candidateProposalVersionId ||
    (thread.consensusType !== "unanimous" &&
      thread.consensusType !== "no_objection" &&
      thread.consensusType !== "silence")
  ) {
    return [];
  }

  const mainParticipants = await getMainParticipants(db, thread.id);
  const objections = (await getThreadObjections(db, thread.id))
    .filter((o) => o.proposalVersionId === thread.candidateProposalVersionId)
    .map((o) => ({
      authorId: o.authorParticipantId,
      blocking: o.blocking ?? false,
      resolvedAt: o.resolvedAt,
      proposalVersionId: o.proposalVersionId!,
    }));
  const approvals = (await getThreadApprovals(db, thread.id))
    .filter((a) => a.proposalVersionId !== null)
    .map((a) => ({
      participantId: a.authorParticipantId,
      proposalVersionId: a.proposalVersionId!,
    }));
  const sessionsAfterAwaiting = thread.awaitingEnteredAt
    ? await listParticipantsWithSessionSince(db, {
        projectId: thread.projectId,
        since: thread.awaitingEnteredAt,
      })
    : [];

  const evaluation = evaluateConsensus({
    consensusType: thread.consensusType,
    candidateVersionId: thread.candidateProposalVersionId,
    objections,
    mainParticipantIds: mainParticipants.map((p) => p.id),
    mainParticipants,
    approvals,
    now: new Date(),
    awaitingEnteredAt: thread.awaitingEnteredAt,
    timingEndsAt: thread.timingEndsAt,
    sessionsAfterAwaiting,
    engineDiversity: thread.engineDiversity,
  });
  return evaluation.reasons;
}

export async function getHumanThreadView(
  db: Db,
  threadId: string,
): Promise<HumanThreadView> {
  const thread = await getThreadRow(db, threadId);
  if (thread.archivedAt) {
    throw new NotFoundError("スレッドが見つかりません");
  }
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
  const [pullRequests, workClaims] = await Promise.all([
    listThreadPullRequests(db, threadId),
    listActiveThreadClaims(db, threadId),
  ]);

  return {
    thread: {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      type: thread.type,
      state: thread.state,
      consensusType: thread.consensusType,
      humanRequired: thread.humanRequired,
      ownerParticipantId: thread.ownerParticipantId,
      awaitingEnteredAt: thread.awaitingEnteredAt?.toISOString() ?? null,
      timingEndsAt: thread.timingEndsAt?.toISOString() ?? null,
      target: thread.target,
      sharedArtifactKind: thread.sharedArtifactKind,
      workPhase: deriveWorkPhase({
        threadType: thread.type,
        threadState: thread.state,
        hasActiveClaim: workClaims.length > 0,
        pullRequestStates: pullRequests.map((pr) => pr.state),
      }),
    },
    consensusReasons: await consensusReasonsOf(db, thread),
    synthesis: await latestSynthesis(db, threadId),
    candidateProposal: await candidateOf(db, thread.candidateProposalVersionId),
    proposals: await listThreadProposals(db, threadId),
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
      createdAt: post.createdAt.toISOString(),
    })),
    pullRequests,
    workClaims,
    decisionView: await getDecisionView(db, threadId),
  };
}

async function listThreadProposals(
  db: Db,
  threadId: string,
): Promise<HumanProposal[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.threadId, threadId), isNull(proposals.archivedAt)))
    .orderBy(asc(proposals.number));
  return Promise.all(
    rows.map(async (proposal) => {
      const [version] = await db
        .select()
        .from(proposalVersions)
        .where(eq(proposalVersions.proposalId, proposal.id))
        .orderBy(desc(proposalVersions.versionNumber))
        .limit(1);
      return {
        id: proposal.id,
        number: proposal.number,
        latestVersionId: version!.id,
        versionNumber: version!.versionNumber,
        content: version!.content,
      };
    }),
  );
}

export async function listProjectThreads(
  db: Db,
  input: { projectId: string },
) {
  const [rows, activeClaims] = await Promise.all([
    db
      .select({
        id: threads.id,
        title: threads.title,
        type: threads.type,
        state: threads.state,
        consensusType: threads.consensusType,
        ownerParticipantId: threads.ownerParticipantId,
        createdAt: threads.createdAt,
      })
      .from(threads)
      .where(
        and(eq(threads.projectId, input.projectId), isNull(threads.archivedAt)),
      )
      .orderBy(desc(threads.createdAt)),
    listActiveProjectClaims(db, input.projectId),
  ]);
  const claimantsByThread = activeClaimantsByThreadId(activeClaims);
  const prByThread = await listProjectPullRequestsForThreads(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const claimants = claimantsByThread.get(row.id) ?? [];
    const pullRequests = prByThread.get(row.id) ?? [];
    return {
      ...row,
      activeWorkClaimants: claimants,
      workPhase: deriveWorkPhase({
        threadType: row.type,
        threadState: row.state,
        hasActiveClaim: claimants.length > 0,
        pullRequestStates: pullRequests.map((pr) => pr.state),
      }),
    };
  });
}

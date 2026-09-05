import { formatParticipantLabel, type PullRequestState, type WorkPhase } from "@comitia/shared";
import { and, eq, isNull } from "drizzle-orm";
import { threads, type HandoverProjectNote } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { computeRemaining } from "./activity.js";
import { searchAgreements } from "./agreements.js";
import { getProjectSetup } from "./constitution.js";
import { getParticipant, getProject } from "./helpers.js";
import { listProjectParticipants } from "./human-ops.js";
import { listMembershipsForParticipant, resolveUniqueMembershipProjectId } from "./memberships.js";
import {
  getLatestPreviousHandover,
  listSessionGoals,
  markSessionDigested,
  openOrGetSession,
  setSessionFocus,
  wasLatestPreviousSessionInterrupted,
} from "./sessions.js";
import { searchThreads } from "./threads.js";
import { listActiveMemory } from "./memory.js";
import {
  listActiveProjectClaims,
  listUnclaimedDecidedImplementations,
} from "./work-claims.js";
import { listProjectPullRequestsForThreads } from "./pull-requests.js";
import { deriveWorkPhase } from "./work-phase.js";

const OPEN_THREAD_STATES = new Set(["discussing", "awaiting_decision"]);

type LinkedPullRequest = {
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
};

type BriefingThreadRow = {
  id: string;
  title: string;
  type: string;
  state: string;
  workPhase: WorkPhase | null;
  pullRequests: LinkedPullRequest[];
};

function withPullRequests<T extends { id: string }>(
  rows: T[],
  prByThread: Map<string, LinkedPullRequest[]>,
): Array<T & { pullRequests: LinkedPullRequest[] }> {
  return rows.map((row) => ({
    ...row,
    pullRequests: prByThread.get(row.id) ?? [],
  }));
}

function withWorkPhase<
  T extends {
    id: string;
    type: string;
    state: string;
    pullRequests: LinkedPullRequest[];
  },
>(
  rows: T[],
  claimedThreadIds: Set<string>,
): Array<T & { workPhase: WorkPhase | null }> {
  return rows.map((row) => ({
    ...row,
    workPhase: deriveWorkPhase({
      threadType: row.type,
      threadState: row.state,
      hasActiveClaim: claimedThreadIds.has(row.id),
      pullRequestStates: row.pullRequests.map((pr) => pr.state),
    }),
  }));
}

export type ProjectBriefingSlice = {
  id: string;
  name: string;
  repoUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  roles: string[];
  rules: string;
  situation: {
    threads: BriefingThreadRow[];
    open_threads: BriefingThreadRow[];
    work_claims: Awaited<ReturnType<typeof listActiveProjectClaims>>;
    unclaimed_decided: Awaited<ReturnType<typeof listUnclaimedDecidedImplementations>>;
    participants: Array<{
      displayName: string;
      roles: string[];
      kind: string;
    }>;
    gates: {
      conflict_citations_required: boolean;
      setup: Awaited<ReturnType<typeof getProjectSetup>>;
    };
    awaiting_decision?: BriefingThreadRow[];
  };
};

async function loadProjectSlice(
  db: Db,
  input: { participantId: string; projectId: string },
): Promise<ProjectBriefingSlice> {
  const ownedThreads = await db
    .select({
      id: threads.id,
      title: threads.title,
      type: threads.type,
      state: threads.state,
    })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, input.projectId),
        eq(threads.ownerParticipantId, input.participantId),
        isNull(threads.archivedAt),
      ),
    );

  const awaitingDecision = ownedThreads.filter(
    (thread) => thread.state === "awaiting_decision",
  );

  const [project, bindingAgreements, allThreads, participants, workClaims, unclaimedDecided, setup] =
    await Promise.all([
      getProject(db, input.projectId),
      searchAgreements(db, {
        projectId: input.projectId,
        onlyActiveBinding: true,
      }),
      searchThreads(db, { projectId: input.projectId }),
      listProjectParticipants(db, input.projectId),
      listActiveProjectClaims(db, input.projectId),
      listUnclaimedDecidedImplementations(db, input.projectId),
      getProjectSetup(db, input.projectId),
    ]);

  const you = participants.find((row) => row.id === input.participantId);
  const openThreadSummaries = allThreads
    .filter((thread) => OPEN_THREAD_STATES.has(thread.state))
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      type: thread.type,
      state: thread.state,
    }));
  const prByThread = await listProjectPullRequestsForThreads(db, [
    ...new Set([
      ...ownedThreads.map((thread) => thread.id),
      ...openThreadSummaries.map((thread) => thread.id),
    ]),
  ]);
  const claimedThreadIds = new Set(workClaims.map((claim) => claim.threadId));
  const ownedWithPrs = withWorkPhase(
    withPullRequests(ownedThreads, prByThread),
    claimedThreadIds,
  );
  const openThreads = withWorkPhase(
    withPullRequests(openThreadSummaries, prByThread),
    claimedThreadIds,
  );
  const awaitingDecisionWithPrs = withWorkPhase(
    withPullRequests(awaitingDecision, prByThread),
    claimedThreadIds,
  );

  return {
    id: project.id,
    name: project.name,
    repoUrl: project.repoUrl,
    githubOwner: project.githubOwner,
    githubRepo: project.githubRepo,
    roles: you?.roles ?? [],
    rules: bindingAgreements.map((agreement) => agreement.summary).join("\n"),
    situation: {
      threads: ownedWithPrs,
      open_threads: openThreads,
      work_claims: workClaims,
      unclaimed_decided: unclaimedDecided,
      participants: participants.map((row) => ({
        displayName: row.label,
        roles: row.roles,
        kind: row.kind,
      })),
      gates: {
        conflict_citations_required: bindingAgreements.length > 0,
        setup,
      },
      ...(awaitingDecisionWithPrs.length > 0
        ? { awaiting_decision: awaitingDecisionWithPrs }
        : {}),
    },
  };
}

export async function getBriefing(
  db: Db,
  input: { participantId: string; projectId?: string | null },
) {
  const session = await openOrGetSession(db, {
    participantId: input.participantId,
  });
  const digestedSession = await markSessionDigested(db, session.id);

  const previousInterrupted = await wasLatestPreviousSessionInterrupted(db, {
    participantId: input.participantId,
    beforeSessionId: digestedSession.id,
  });
  const previousHandover = previousInterrupted
    ? { body: "", projects: [] as HandoverProjectNote[] }
    : await getLatestPreviousHandover(db, {
        participantId: input.participantId,
        beforeSessionId: digestedSession.id,
      });

  const memberships = await listMembershipsForParticipant(db, input.participantId);
  const uniqueProjectId = await resolveUniqueMembershipProjectId(
    db,
    input.participantId,
  );
  if (!digestedSession.focusProjectId && uniqueProjectId) {
    await setSessionFocus(db, {
      sessionId: digestedSession.id,
      projectId: uniqueProjectId,
    });
    digestedSession.focusProjectId = uniqueProjectId;
    digestedSession.projectId = uniqueProjectId;
  }

  const projectSlices = await Promise.all(
    memberships.map((membership) =>
      loadProjectSlice(db, {
        participantId: input.participantId,
        projectId: membership.id,
      }),
    ),
  );

  const goals = await listSessionGoals(db, digestedSession.id);
  const incompleteGoals = goals
    .filter((goal) => goal.status === "pending")
    .map((goal) => ({
      id: goal.id,
      text: goal.text,
      status: goal.status,
    }));

  const participant = await getParticipant(db, input.participantId);
  const [activeMemory, owner] = await Promise.all([
    listActiveMemory(db, input.participantId),
    participant.ownerParticipantId
      ? getParticipant(db, participant.ownerParticipantId)
      : Promise.resolve(null),
  ]);

  const sole = projectSlices.length === 1 ? projectSlices[0]! : null;
  const focused = projectSlices.find(
    (slice) => slice.id === digestedSession.focusProjectId,
  );

  const sessionSituation = {
    incomplete_goals: incompleteGoals,
    ...(previousInterrupted ? { previous_interrupted: true } : {}),
  };

  return {
    sessionId: digestedSession.id,
    handover: previousHandover.body,
    previous_projects: previousHandover.projects,
    memory: activeMemory.map((m) => m.body).join("\n"),
    you: {
      displayName: formatParticipantLabel({
        kind: participant.kind,
        displayName: participant.displayName,
        ownerDisplayName: owner?.displayName,
      }),
      roles: sole?.roles ?? [],
      engine: participant.engine,
      ...(participant.personality
        ? { personality: participant.personality }
        : {}),
    },
    project: sole
      ? {
          name: sole.name,
          repoUrl: sole.repoUrl,
          githubOwner: sole.githubOwner,
          githubRepo: sole.githubRepo,
        }
      : null,
    projects: projectSlices,
    focus_project: focused
      ? { id: focused.id, name: focused.name }
      : null,
    rules: sole?.rules ?? "",
    situation: {
      threads: sole?.situation.threads ?? [],
      open_threads: sole?.situation.open_threads ?? [],
      work_claims: sole?.situation.work_claims ?? [],
      unclaimed_decided: sole?.situation.unclaimed_decided ?? [],
      participants: sole?.situation.participants ?? [],
      gates: sole?.situation.gates ?? {
        conflict_citations_required: false,
        setup: { projectRule: false, threadTemplate: false },
      },
      ...(sole?.situation.awaiting_decision
        ? { awaiting_decision: sole.situation.awaiting_decision }
        : {}),
      ...sessionSituation,
    },
    remaining_budget: computeRemaining(digestedSession),
  };
}

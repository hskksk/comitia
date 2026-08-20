import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AgreementState } from "@comitia/shared";
import {
  agentConnections,
  agentCredentials,
  agreements,
  events,
  participants,
  roleAssignments,
  sessions,
  threads,
  ticks,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { computeRemaining } from "./activity.js";
import { PermissionDenied } from "./errors.js";
import { getParticipant, getProject } from "./helpers.js";
import { listNonblockingInbox, listJudgmentQueue } from "./human-views.js";
import { getSessionById, listSessionGoals } from "./sessions.js";

export type ConnectionStatus = "connected" | "disconnected" | "never";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function getProjectSummary(db: Db, projectId: string) {
  const project = await getProject(db, projectId);
  const rows = await db
    .select({
      state: threads.state,
      type: threads.type,
    })
    .from(threads)
    .where(eq(threads.projectId, projectId));

  const threadCounts = {
    discussing: 0,
    awaiting_decision: 0,
    decided: 0,
    rejected: 0,
    completed: 0,
  };
  for (const row of rows) {
    threadCounts[row.state] += 1;
  }

  const [queue, inbox] = await Promise.all([
    listJudgmentQueue(db, { projectId }),
    listNonblockingInbox(db, { projectId }),
  ]);

  return {
    id: project.id,
    name: project.name,
    threadCounts,
    queueCount: queue.length,
    inboxCount: inbox.length,
    repoUrl: project.repoUrl,
    githubOwner: project.githubOwner,
    githubRepo: project.githubRepo,
    githubInstallationId: project.githubInstallationId !== null,
  };
}

export async function listProjectParticipants(db: Db, projectId: string) {
  const project = await getProject(db, projectId);
  const owner = await getParticipant(db, project.ownerParticipantId);
  const ownedAgents = await db
    .select()
    .from(participants)
    .where(eq(participants.ownerParticipantId, owner.id));
  const creds = await db
    .select()
    .from(agentCredentials)
    .where(eq(agentCredentials.projectId, projectId));
  const credAgentIds = creds.map((row) => row.participantId);
  const credAgents =
    credAgentIds.length === 0
      ? []
      : await db
          .select()
          .from(participants)
          .where(inArray(participants.id, credAgentIds));

  const byId = new Map<string, (typeof owner)>();
  byId.set(owner.id, owner);
  for (const person of [...ownedAgents, ...credAgents]) {
    byId.set(person.id, person);
  }
  const people = [...byId.values()];
  const ids = people.map((row) => row.id);
  const agentIds = people.filter((row) => row.kind === "agent").map((row) => row.id);

  const roleRows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.projectId, projectId),
              inArray(roleAssignments.participantId, ids),
            ),
          );

  const connRows =
    agentIds.length === 0
      ? []
      : await db
          .select()
          .from(agentConnections)
          .where(inArray(agentConnections.participantId, agentIds));

  const openRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), isNull(sessions.endedAt)));

  const queuedStartTicks =
    agentIds.length === 0
      ? []
      : await db
          .select({ participantId: ticks.participantId })
          .from(ticks)
          .where(
            and(
              inArray(ticks.participantId, agentIds),
              eq(ticks.status, "queued"),
              eq(ticks.type, "session.start"),
            ),
          );
  const queuedSet = new Set(queuedStartTicks.map((row) => row.participantId));

  const rolesByParticipant = new Map<string, string[]>();
  for (const row of roleRows) {
    const list = rolesByParticipant.get(row.participantId) ?? [];
    list.push(row.role);
    rolesByParticipant.set(row.participantId, list);
  }

  const connByParticipant = new Map(
    connRows.map((row) => [row.participantId, row]),
  );
  const sessionByParticipant = new Map(
    openRows.map((row) => [row.participantId, row]),
  );

  return Promise.all(
    people.map(async (person) => {
      const open = sessionByParticipant.get(person.id);
      const goals = open ? await listSessionGoals(db, open.id) : [];
      const conn = connByParticipant.get(person.id);
      let connection: {
        status: ConnectionStatus;
        lastSeenAt: string | null;
      } | null = null;
      if (person.kind === "agent") {
        connection = conn
          ? {
              status: conn.status,
              lastSeenAt: iso(conn.lastSeenAt),
            }
          : { status: "never", lastSeenAt: null };
      }
      let wake: "undigested" | "queued" | "idle" | null = null;
      if (person.kind === "agent") {
        if (open && open.briefingAt === null) {
          wake = "undigested";
        } else if (queuedSet.has(person.id)) {
          wake = "queued";
        } else if (!open) {
          wake = "idle";
        }
      }

      return {
        id: person.id,
        kind: person.kind,
        displayName: person.displayName,
        engine: person.engine,
        ownerParticipantId: person.ownerParticipantId,
        roles: rolesByParticipant.get(person.id) ?? [],
        connection,
        openSession: open
          ? {
              id: open.id,
              remainingBudget: computeRemaining(open),
              firstGoal: goals[0]?.text ?? null,
              startedAt: open.startedAt.toISOString(),
            }
          : null,
        wake,
      };
    }),
  );
}

async function serializeSession(db: Db, session: typeof sessions.$inferSelect) {
  const goals = await listSessionGoals(db, session.id);
  const [person] = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
    })
    .from(participants)
    .where(eq(participants.id, session.participantId))
    .limit(1);
  return {
    id: session.id,
    participantId: session.participantId,
    displayName: person?.displayName ?? session.participantId,
    startedAt: session.startedAt.toISOString(),
    endedAt: iso(session.endedAt),
    endedReason: session.endedReason,
    remainingBudget: computeRemaining(session),
    budgetLimit: session.budgetLimit,
    budgetUsed: session.budgetUsed,
    goals: goals.map((goal) => ({
      id: goal.id,
      text: goal.text,
      status: goal.status,
    })),
  };
}

export async function listOpenSessions(db: Db, projectId: string) {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), isNull(sessions.endedAt)))
    .orderBy(desc(sessions.startedAt));
  return Promise.all(rows.map((row) => serializeSession(db, row)));
}

export async function listAgentSessions(
  db: Db,
  input: { projectId: string; agentId: string; actorId: string },
) {
  const agent = await getParticipant(db, input.agentId);
  if (agent.kind !== "agent") {
    return null;
  }
  if (agent.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("登録オーナーだけがセッションを見られます");
  }
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.participantId, input.agentId),
        eq(sessions.projectId, input.projectId),
      ),
    )
    .orderBy(desc(sessions.startedAt));
  return Promise.all(rows.map((row) => serializeSession(db, row)));
}

export async function getOwnerChatLog(
  db: Db,
  input: {
    sessionId: string;
    actorId: string;
    tailChars?: number;
    fromStart?: boolean;
  },
) {
  const session = await getSessionById(db, input.sessionId);
  const agent = await getParticipant(db, session.participantId);
  if (agent.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("登録オーナーだけがログを読めます");
  }
  const full = session.chatLog;
  const fromStart = input.fromStart === true;
  const tailChars = input.tailChars ?? 65_536;
  const chatLog =
    fromStart || full.length <= tailChars
      ? full
      : full.slice(full.length - tailChars);
  return {
    sessionId: session.id,
    participantId: session.participantId,
    startedAt: session.startedAt.toISOString(),
    endedAt: iso(session.endedAt),
    chatLog,
    truncated: chatLog.length < full.length,
  };
}

export async function listHumanAgreements(
  db: Db,
  input: { projectId: string; state?: AgreementState; q?: string },
) {
  const conditions = [eq(agreements.projectId, input.projectId)];
  if (input.state) {
    conditions.push(eq(agreements.state, input.state));
  } else {
    conditions.push(eq(agreements.state, "active"));
  }
  const rows = await db
    .select()
    .from(agreements)
    .where(and(...conditions))
    .orderBy(desc(agreements.createdAt));
  const query = input.q?.trim().toLowerCase();
  const filtered = query
    ? rows.filter((row) => row.summary.toLowerCase().includes(query))
    : rows;
  const threadIds = [...new Set(filtered.map((row) => row.threadId))];
  const threadRows =
    threadIds.length === 0
      ? []
      : await db
          .select({ id: threads.id, title: threads.title })
          .from(threads)
          .where(inArray(threads.id, threadIds));
  const titleById = new Map(threadRows.map((row) => [row.id, row.title]));
  return filtered.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    threadTitle: titleById.get(row.threadId) ?? null,
    proposalVersionId: row.proposalVersionId,
    outcome: row.outcome,
    binding: row.binding,
    state: row.state,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listRecentEvents(
  db: Db,
  input: { projectId: string; limit: number },
) {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.projectId, input.projectId))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(input.limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    threadId: row.threadId,
    actorParticipantId: row.actorParticipantId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  }));
}

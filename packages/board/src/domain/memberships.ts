import { and, eq } from "drizzle-orm";
import { projectMemberships, projects } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import { getParticipant, getProject } from "./helpers.js";

export async function addMembership(
  db: Db,
  input: {
    projectId: string;
    participantId: string;
    actorId?: string | null;
  },
) {
  const [existing] = await db
    .select({ id: projectMemberships.id })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, input.projectId),
        eq(projectMemberships.participantId, input.participantId),
      ),
    )
    .limit(1);
  if (existing) {
    return existing;
  }

  const [row] = await db
    .insert(projectMemberships)
    .values({
      projectId: input.projectId,
      participantId: input.participantId,
    })
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.actorId ?? input.participantId,
    kind: "project_membership_added",
    payload: {
      projectId: input.projectId,
      participantId: input.participantId,
    },
  });
  return row!;
}

export async function isProjectMember(
  db: Db,
  projectId: string,
  participantId: string,
) {
  const [row] = await db
    .select({ id: projectMemberships.id })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.participantId, participantId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function assertProjectMember(
  db: Db,
  projectId: string,
  participantId: string,
) {
  await getProject(db, projectId);
  if (!(await isProjectMember(db, projectId, participantId))) {
    throw new PermissionDenied("このプロジェクトのメンバーではありません");
  }
}

export async function listMembershipsForParticipant(
  db: Db,
  participantId: string,
) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      repoUrl: projects.repoUrl,
      ownerParticipantId: projects.ownerParticipantId,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
    .where(eq(projectMemberships.participantId, participantId));
}

export async function listMemberParticipantIds(db: Db, projectId: string) {
  const rows = await db
    .select({ participantId: projectMemberships.participantId })
    .from(projectMemberships)
    .where(eq(projectMemberships.projectId, projectId));
  return rows.map((row) => row.participantId);
}

export async function removeHumanMember(
  db: Db,
  input: { projectId: string; participantId: string; actorId: string },
) {
  const project = await getProject(db, input.projectId);
  if (project.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("プロジェクトオーナーのみ実行できます");
  }
  if (input.participantId === project.ownerParticipantId) {
    throw new GateViolation("プロジェクトオーナーは外せません");
  }
  const target = await getParticipant(db, input.participantId);
  if (target.kind !== "human") {
    throw new GateViolation("エージェントは登録者の設定から外します");
  }
  const [deleted] = await db
    .delete(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, input.projectId),
        eq(projectMemberships.participantId, input.participantId),
      ),
    )
    .returning();
  if (!deleted) {
    throw new NotFoundError("メンバーが見つかりません");
  }
  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.actorId,
    kind: "project_membership_removed",
    payload: {
      projectId: input.projectId,
      participantId: input.participantId,
    },
  });
}

export async function resolveUniqueMembershipProjectId(
  db: Db,
  participantId: string,
) {
  const memberships = await db
    .select({ projectId: projectMemberships.projectId })
    .from(projectMemberships)
    .where(eq(projectMemberships.participantId, participantId));
  if (memberships.length === 1) {
    return memberships[0]!.projectId;
  }
  return null;
}

/** Human credentials may still carry a legacy projectId. Agent tools resolve via membership + focus. */
export async function resolveHumanProjectId(
  db: Db,
  input: {
    participantId: string;
    credentialProjectId: string | null;
    headerProjectId?: string | null;
    explicitProjectId?: string | null;
  },
) {
  const projectId =
    input.explicitProjectId ||
    input.headerProjectId ||
    input.credentialProjectId ||
    (await resolveUniqueMembershipProjectId(db, input.participantId));
  if (!projectId) {
    throw new GateViolation("project required");
  }
  await assertProjectMember(db, projectId, input.participantId);
  return projectId;
}

export const PROJECT_ID_REQUIRED_MESSAGE =
  "project_id が必要です。所属が複数あるので、use_project で今日関わるプロジェクトを選ぶか、ツール引数で指定してください";

export async function resolveAgentToolProjectId(
  db: Db,
  input: {
    participantId: string;
    requestedProjectId?: string | null;
    focusProjectId?: string | null;
  },
) {
  const projectId =
    input.requestedProjectId ||
    input.focusProjectId ||
    (await resolveUniqueMembershipProjectId(db, input.participantId));
  if (!projectId) {
    throw new GateViolation(PROJECT_ID_REQUIRED_MESSAGE);
  }
  await assertProjectMember(db, projectId, input.participantId);
  return projectId;
}

export async function addOwnedAgentToProject(
  db: Db,
  input: { actorId: string; agentId: string; projectId: string },
) {
  await assertProjectMember(db, input.projectId, input.actorId);
  const actor = await getParticipant(db, input.actorId);
  if (actor.kind !== "human") {
    throw new PermissionDenied("人間だけがエージェントをプロジェクトに足せます");
  }
  const agent = await getParticipant(db, input.agentId);
  if (agent.kind !== "agent" || agent.archivedAt) {
    throw new NotFoundError("エージェントが見つかりません");
  }
  if (agent.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("登録オーナーだけが自分のエージェントを足せます");
  }
  return addMembership(db, {
    projectId: input.projectId,
    participantId: input.agentId,
    actorId: input.actorId,
  });
}

import { agentNameContainsSeparator, isSupportedEngine, ENGINES } from "@comitia/shared";
import { and, eq, isNull } from "drizzle-orm";
import { agentCredentials, participants, projectMemberships } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { GateViolation, NotFoundError, PermissionDenied } from "./errors.js";
import { getParticipant } from "./helpers.js";
import { normalizePersonality } from "./personality.js";

export async function listOwnedAgents(db: Db, ownerParticipantId: string) {
  return db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.ownerParticipantId, ownerParticipantId),
        eq(participants.kind, "agent"),
        isNull(participants.archivedAt),
      ),
    );
}

export async function updateOwnedAgent(
  db: Db,
  input: {
    actorId: string;
    agentId: string;
    displayName?: string;
    engine?: string;
    personality?: string | null;
  },
) {
  const agent = await getParticipant(db, input.agentId);
  if (agent.kind !== "agent" || agent.archivedAt) {
    throw new NotFoundError("エージェントが見つかりません");
  }
  if (agent.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("登録オーナーだけがエージェントを更新できます");
  }
  if (
    input.displayName !== undefined &&
    agentNameContainsSeparator(input.displayName)
  ) {
    throw new GateViolation("エージェント名に @ は使えません");
  }
  if (input.engine !== undefined && !isSupportedEngine(input.engine)) {
    throw new GateViolation(`engine must be one of: ${ENGINES.join(", ")}`);
  }
  const personality =
    input.personality === undefined
      ? undefined
      : normalizePersonality(input.personality);
  const [updated] = await db
    .update(participants)
    .set({
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.engine !== undefined ? { engine: input.engine } : {}),
      ...(personality !== undefined ? { personality } : {}),
    })
    .where(eq(participants.id, agent.id))
    .returning();
  await recordEvent(db, {
    actorParticipantId: input.actorId,
    kind: "agent_updated",
    payload: {
      agentId: agent.id,
      displayName: updated!.displayName,
      engine: updated!.engine,
      personality: updated!.personality,
    },
  });
  return updated!;
}

export async function archiveOwnedAgent(
  db: Db,
  input: { actorId: string; agentId: string },
) {
  const agent = await getParticipant(db, input.agentId);
  if (agent.kind !== "agent" || agent.archivedAt) {
    throw new NotFoundError("エージェントが見つかりません");
  }
  if (agent.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("登録オーナーだけがエージェントを削除できます");
  }
  await db
    .update(participants)
    .set({ archivedAt: new Date() })
    .where(eq(participants.id, agent.id));
  await db
    .update(agentCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(agentCredentials.participantId, agent.id));
  await recordEvent(db, {
    actorParticipantId: input.actorId,
    kind: "agent_archived",
    payload: { agentId: agent.id },
  });
}

export async function getAgentCredentialProjectId(db: Db, agentId: string) {
  const [cred] = await db
    .select({ projectId: agentCredentials.projectId })
    .from(agentCredentials)
    .where(
      and(
        eq(agentCredentials.participantId, agentId),
        isNull(agentCredentials.revokedAt),
      ),
    )
    .limit(1);
  return cred?.projectId ?? null;
}

export async function agentBelongsToProject(
  db: Db,
  agentId: string,
  projectId: string,
) {
  const [row] = await db
    .select({ id: projectMemberships.id })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.participantId, agentId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

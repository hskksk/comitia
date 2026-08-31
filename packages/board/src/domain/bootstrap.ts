import { eq } from "drizzle-orm";
import { ENGINES, agentNameContainsSeparator, isSupportedEngine } from "@comitia/shared";
import {
  agentConnections,
  agentCredentials,
  participants,
  roleAssignments,
} from "../db/schema.js";
import type { DbClient } from "../db/types.js";
import { assignSessionStartMinute } from "./connections.js";
import { hashToken, issueToken } from "./credentials.js";
import { GateViolation } from "./errors.js";
import { recordEvent } from "./events.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";
import type { ProjectRole } from "./roles.js";
import { addMembership, isProjectMember, resolveUniqueMembershipProjectId } from "./memberships.js";
import { getProject } from "./helpers.js";

export async function bootstrapBoard(
  db: DbClient,
  input: { ownerDisplayName: string; projectName: string; repoUrl?: string },
) {
  return db.transaction(async (tx) => {
    const [existingHuman] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.kind, "human"))
      .limit(1);
    if (existingHuman) {
      throw new GateViolation("already initialized");
    }

    const owner = await registerParticipant(tx, {
      kind: "human",
      displayName: input.ownerDisplayName,
    });
    await registerParticipant(tx, {
      kind: "system",
      displayName: "Comitia",
    });
    const project = await createProject(tx, {
      name: input.projectName,
      ownerParticipantId: owner.id,
      repoUrl: input.repoUrl,
    });
    const ownerToken = issueToken();
    await tx.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: null,
      clientLabel: "init",
      tokenHash: hashToken(ownerToken),
    });

    return { owner, project, ownerToken };
  });
}

export async function registerAgent(
  db: DbClient,
  input: {
    ownerParticipantId: string;
    displayName: string;
    engine: string;
    role?: ProjectRole;
    projectId?: string;
    personality?: string | null;
  },
) {
  if (!isSupportedEngine(input.engine)) {
    throw new GateViolation(`engine must be one of: ${ENGINES.join(", ")}`);
  }
  if (agentNameContainsSeparator(input.displayName)) {
    throw new GateViolation("エージェント名に @ は使えません");
  }

  return db.transaction(async (tx) => {
    let projectId = input.projectId;
    if (!projectId) {
      projectId =
        (await resolveUniqueMembershipProjectId(tx, input.ownerParticipantId)) ??
        undefined;
    }
    if (!projectId) {
      throw new GateViolation("project required");
    }
    await getProject(tx, projectId);
    const member = await isProjectMember(
      tx,
      projectId,
      input.ownerParticipantId,
    );
    if (!member) {
      throw new GateViolation("このプロジェクトのメンバーではありません");
    }

    const existingConnections = await tx
      .select({ participantId: agentConnections.participantId })
      .from(agentConnections);
    const agent = await registerParticipant(tx, {
      kind: "agent",
      displayName: input.displayName,
      ownerParticipantId: input.ownerParticipantId,
      engine: input.engine,
      personality: input.personality,
    });
    const agentToken = issueToken();
    await tx.insert(agentCredentials).values({
      participantId: agent.id,
      projectId,
      clientLabel: "agent",
      tokenHash: hashToken(agentToken),
    });
    await tx.insert(agentConnections).values({
      participantId: agent.id,
      sessionStartMinute: assignSessionStartMinute(existingConnections.length),
    });
    await addMembership(tx, {
      projectId,
      participantId: agent.id,
      actorId: input.ownerParticipantId,
    });
    if (input.role) {
      const [assignment] = await tx
        .insert(roleAssignments)
        .values({
          projectId,
          participantId: agent.id,
          role: input.role,
        })
        .returning();
      await recordEvent(tx, {
        projectId,
        actorParticipantId: input.ownerParticipantId,
        kind: "role_assigned",
        payload: {
          roleAssignmentId: assignment!.id,
          participantId: agent.id,
          role: input.role,
        },
      });
    }

    return { agent, projectId, agentToken };
  });
}

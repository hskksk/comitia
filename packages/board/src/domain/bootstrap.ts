import { eq } from "drizzle-orm";
import {
  agentConnections,
  agentCredentials,
  participants,
  projects,
} from "../db/schema.js";
import type { DbClient } from "../db/types.js";
import { assignSessionStartMinute } from "./connections.js";
import { hashToken, issueToken } from "./credentials.js";
import { GateViolation } from "./errors.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";

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
    const project = await createProject(tx, {
      name: input.projectName,
      ownerParticipantId: owner.id,
      repoUrl: input.repoUrl,
    });
    const ownerToken = issueToken();
    await tx.insert(agentCredentials).values({
      participantId: owner.id,
      projectId: project.id,
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
  },
) {
  if (input.engine !== "claude-code") {
    throw new GateViolation("engine must be claude-code");
  }

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerParticipantId, input.ownerParticipantId))
      .limit(1);
    if (!project) {
      throw new GateViolation("owner project not found");
    }

    const existingConnections = await tx
      .select({ participantId: agentConnections.participantId })
      .from(agentConnections);
    const agent = await registerParticipant(tx, {
      kind: "agent",
      displayName: input.displayName,
      ownerParticipantId: input.ownerParticipantId,
      engine: input.engine,
    });
    const agentToken = issueToken();
    await tx.insert(agentCredentials).values({
      participantId: agent.id,
      projectId: project.id,
      tokenHash: hashToken(agentToken),
    });
    await tx.insert(agentConnections).values({
      participantId: agent.id,
      sessionStartMinute: assignSessionStartMinute(existingConnections.length),
    });

    return { agent, projectId: project.id, agentToken };
  });
}

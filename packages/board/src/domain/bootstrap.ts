import { eq } from "drizzle-orm";
import {
  agentConnections,
  agentCredentials,
  participants,
  projects,
} from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { assignSessionStartMinute } from "./connections.js";
import { hashToken, issueToken } from "./credentials.js";
import { GateViolation } from "./errors.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";

export async function bootstrapBoard(
  db: Db,
  input: { ownerDisplayName: string; projectName: string },
) {
  const [existingHuman] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.kind, "human"))
    .limit(1);
  if (existingHuman) {
    throw new GateViolation("already initialized");
  }

  const owner = await registerParticipant(db, {
    kind: "human",
    displayName: input.ownerDisplayName,
  });
  const project = await createProject(db, {
    name: input.projectName,
    ownerParticipantId: owner.id,
  });
  const ownerToken = issueToken();
  await db.insert(agentCredentials).values({
    participantId: owner.id,
    projectId: project.id,
    tokenHash: hashToken(ownerToken),
  });

  return { owner, project, ownerToken };
}

export async function registerAgent(
  db: Db,
  input: {
    ownerParticipantId: string;
    displayName: string;
    engine: string;
  },
) {
  if (input.engine !== "claude-code") {
    throw new GateViolation("engine must be claude-code");
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerParticipantId, input.ownerParticipantId))
    .limit(1);
  if (!project) {
    throw new GateViolation("owner project not found");
  }

  const existingConnections = await db
    .select({ participantId: agentConnections.participantId })
    .from(agentConnections);
  const agent = await registerParticipant(db, {
    kind: "agent",
    displayName: input.displayName,
    ownerParticipantId: input.ownerParticipantId,
    engine: input.engine,
  });
  const agentToken = issueToken();
  await db.insert(agentCredentials).values({
    participantId: agent.id,
    projectId: project.id,
    tokenHash: hashToken(agentToken),
  });
  await db.insert(agentConnections).values({
    participantId: agent.id,
    sessionStartMinute: assignSessionStartMinute(existingConnections.length),
  });

  return { agent, projectId: project.id, agentToken };
}

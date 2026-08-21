import { formatParticipantLabel } from "@comitia/shared";
import { and, eq } from "drizzle-orm";
import { roleAssignments } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { getParticipant, getProject } from "./helpers.js";
import { listMembershipsForParticipant } from "./memberships.js";

export async function buildMeResponse(
  db: Db,
  input: {
    participant: {
      id: string;
      kind: "human" | "agent" | "system";
      displayName: string;
      engine: string | null;
      ownerParticipantId: string | null;
      githubLogin: string | null;
      githubUserId: string | null;
    };
    credentialProjectId: string | null;
    selectedProjectId?: string;
  },
) {
  if (input.participant.kind === "system") {
    return {
      participant: {
        id: input.participant.id,
        kind: input.participant.kind,
        displayName: input.participant.displayName,
      },
      projectId: null,
    };
  }

  if (input.participant.kind === "agent") {
    const owner = input.participant.ownerParticipantId
      ? await getParticipant(db, input.participant.ownerParticipantId)
      : null;
    const memberships = await listMembershipsForParticipant(
      db,
      input.participant.id,
    );
    const projectId =
      input.selectedProjectId ??
      input.credentialProjectId ??
      (memberships.length === 1 ? memberships[0]!.id : null);
    const project = projectId ? await getProject(db, projectId) : null;
    const roles = projectId
      ? await db
          .select({ role: roleAssignments.role })
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.participantId, input.participant.id),
              eq(roleAssignments.projectId, projectId),
            ),
          )
      : [];
    return {
      participant: {
        id: input.participant.id,
        kind: input.participant.kind,
        displayName: input.participant.displayName,
        engine: input.participant.engine,
      },
      label: formatParticipantLabel({
        kind: "agent",
        displayName: input.participant.displayName,
        ownerDisplayName: owner?.displayName,
      }),
      owner: owner
        ? { id: owner.id, displayName: owner.displayName }
        : null,
      project: project
        ? { id: project.id, name: project.name, repoUrl: project.repoUrl }
        : null,
      projects: memberships.map((row) => ({
        id: row.id,
        name: row.name,
        repoUrl: row.repoUrl,
        ownerParticipantId: row.ownerParticipantId,
      })),
      roles: roles.map((row) => row.role),
      projectId: project?.id ?? null,
    };
  }

  const projects = await listMembershipsForParticipant(db, input.participant.id);
  const projectId =
    input.selectedProjectId ??
    input.credentialProjectId ??
    (projects.length === 1 ? projects[0]!.id : null);
  return {
    participant: {
      id: input.participant.id,
      kind: input.participant.kind,
      displayName: input.participant.displayName,
      githubLogin: input.participant.githubLogin,
      githubUserId: input.participant.githubUserId,
    },
    projects,
    projectId,
  };
}

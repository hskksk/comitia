import { projects } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { PermissionDenied } from "./errors.js";
import { getParticipant } from "./helpers.js";

export async function createProject(
  db: Db,
  input: {
    name: string;
    ownerParticipantId: string;
    repoUrl?: string;
  },
) {
  const owner = await getParticipant(db, input.ownerParticipantId);
  if (owner.kind !== "human") {
    throw new PermissionDenied("プロジェクトオーナーは人間である必要があります");
  }

  const [project] = await db
    .insert(projects)
    .values({
      name: input.name,
      ownerParticipantId: input.ownerParticipantId,
      repoUrl: input.repoUrl ?? null,
    })
    .returning();

  await recordEvent(db, {
    projectId: project!.id,
    actorParticipantId: input.ownerParticipantId,
    kind: "project_created",
    payload: {
      projectId: project!.id,
      name: input.name,
      repoUrl: input.repoUrl ?? null,
    },
  });

  return project!;
}

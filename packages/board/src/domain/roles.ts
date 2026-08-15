import { roleAssignments } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";
import { assertProjectOwner } from "./helpers.js";

export async function assignRole(
  db: Db,
  input: {
    projectId: string;
    participantId: string;
    role:
      | "facilitator"
      | "proposer"
      | "reviewer"
      | "recorder"
      | "executor";
    actorId: string;
  },
) {
  await assertProjectOwner(db, input.projectId, input.actorId);

  const [assignment] = await db
    .insert(roleAssignments)
    .values({
      projectId: input.projectId,
      participantId: input.participantId,
      role: input.role,
    })
    .returning();

  await recordEvent(db, {
    projectId: input.projectId,
    actorParticipantId: input.actorId,
    kind: "role_assigned",
    payload: {
      roleAssignmentId: assignment!.id,
      participantId: input.participantId,
      role: input.role,
    },
  });

  return assignment!;
}

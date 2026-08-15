import { participants } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { recordEvent } from "./events.js";

export async function registerParticipant(
  db: Db,
  input: {
    kind: "human" | "agent";
    displayName: string;
    ownerParticipantId?: string;
    engine?: string;
  },
) {
  const [participant] = await db
    .insert(participants)
    .values({
      kind: input.kind,
      displayName: input.displayName,
      ownerParticipantId: input.ownerParticipantId ?? null,
      engine: input.engine ?? null,
    })
    .returning();

  await recordEvent(db, {
    actorParticipantId: participant!.id,
    kind: "participant_registered",
    payload: {
      participantId: participant!.id,
      kind: input.kind,
      displayName: input.displayName,
    },
  });

  return participant!;
}

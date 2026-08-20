import { eq } from "drizzle-orm";
import { participants } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { NotFoundError } from "./errors.js";
import { recordEvent } from "./events.js";

export async function registerParticipant(
  db: Db,
  input: {
    kind: "human" | "agent" | "system";
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

/** 唯一のシステム参加者（Comitia）を返す。資格情報・接続を持たない。 */
export async function getSystemParticipant(db: Db) {
  const [row] = await db
    .select()
    .from(participants)
    .where(eq(participants.kind, "system"))
    .limit(1);
  if (!row) {
    throw new NotFoundError("システム参加者が見つかりません");
  }
  return row;
}

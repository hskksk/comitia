import type { EventKind } from "@comitia/shared";
import { events } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";

export async function recordEvent(
  db: Db,
  input: {
    projectId?: string | null;
    threadId?: string | null;
    actorParticipantId?: string | null;
    kind: EventKind;
    payload: Record<string, unknown>;
  },
) {
  const [event] = await db
    .insert(events)
    .values({
      projectId: input.projectId,
      threadId: input.threadId ?? null,
      actorParticipantId: input.actorParticipantId ?? null,
      kind: input.kind,
      payload: input.payload,
    })
    .returning();
  return event!;
}

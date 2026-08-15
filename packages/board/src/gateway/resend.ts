import { and, isNull, lte } from "drizzle-orm";
import { sessions } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { SendTickInput, SendTickResult } from "./send-tick.js";

export async function resendUndigested(
  db: Db,
  send: (input: SendTickInput) => Promise<SendTickResult>,
  input: { now: Date; timeoutMs: number },
): Promise<void> {
  const cutoff = new Date(input.now.getTime() - input.timeoutMs);
  const stale = await db
    .select()
    .from(sessions)
    .where(
      and(
        isNull(sessions.endedAt),
        isNull(sessions.briefingAt),
        lte(sessions.startedAt, cutoff),
      ),
    );

  for (const session of stale) {
    await send({
      participantId: session.participantId,
      type: "session.start",
    });
  }
}

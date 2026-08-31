import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { TraceEvent, TraceEventInput, TraceKind } from "@comitia/shared";
import { TRACE_VERSION } from "@comitia/shared";
import { sessionTraceEntries, sessions } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { PermissionDenied } from "./errors.js";
import { getParticipant } from "./helpers.js";
import { getSessionById } from "./sessions.js";

const DEFAULT_TRACE_LIMIT = 500;
export const MAX_TRACE_LIMIT = 2_000;

function traceEventToRow(
  sessionId: string,
  seq: number,
  event: TraceEventInput,
): typeof sessionTraceEntries.$inferInsert {
  const { v, seq: adapterSeq, at, kind, run, ...rest } = event;
  return {
    sessionId,
    seq,
    at: new Date(at),
    kind,
    run: run ?? null,
    payload: {
      v: v ?? TRACE_VERSION,
      ...(typeof adapterSeq === "number" ? { adapter_seq: adapterSeq } : {}),
      ...rest,
    },
  };
}

export function traceRowToEvent(
  row: typeof sessionTraceEntries.$inferSelect,
): TraceEvent {
  const payload = { ...(row.payload as Record<string, unknown>) };
  const adapterSeq = payload.adapter_seq;
  delete payload.adapter_seq;
  const version = payload.v ?? TRACE_VERSION;
  delete payload.v;
  return {
    v: version as typeof TRACE_VERSION,
    seq: row.seq,
    at: row.at.toISOString(),
    kind: row.kind as TraceKind,
    run: row.run ?? undefined,
    ...payload,
    ...(typeof adapterSeq === "number" ? { adapterSeq } : {}),
  } as TraceEvent;
}

export async function appendSessionTraceEntries(
  db: Db,
  input: {
    sessionId: string;
    participantId: string;
    entries: TraceEventInput[];
  },
): Promise<{ lastSeq: number }> {
  if (input.entries.length === 0) {
    return { lastSeq: 0 };
  }
  const session = await getSessionById(db, input.sessionId);
  if (session.participantId !== input.participantId) {
    throw new PermissionDenied("セッションの所有者ではありません");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${sessions.id} from ${sessions} where ${sessions.id} = ${input.sessionId} for update`,
    );
    const [maxRow] = await tx
      .select({
        maxSeq: sql<number>`coalesce(max(${sessionTraceEntries.seq}), 0)`,
      })
      .from(sessionTraceEntries)
      .where(eq(sessionTraceEntries.sessionId, input.sessionId));
    let nextSeq = Number(maxRow?.maxSeq ?? 0);

    const rows = input.entries.map((event) => {
      nextSeq += 1;
      return traceEventToRow(input.sessionId, nextSeq, event);
    });
    await tx.insert(sessionTraceEntries).values(rows);
    return { lastSeq: nextSeq };
  });
}

export async function getOwnerSessionTrace(
  db: Db,
  input: {
    sessionId: string;
    actorId: string;
    afterSeq?: number;
    limit?: number;
  },
) {
  const session = await getSessionById(db, input.sessionId);
  const agent = await getParticipant(db, session.participantId);
  if (agent.ownerParticipantId !== input.actorId) {
    throw new PermissionDenied("登録オーナーだけがトレースを読めます");
  }

  const afterSeq = input.afterSeq ?? 0;
  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_TRACE_LIMIT, 1),
    MAX_TRACE_LIMIT,
  );

  const rows = await db
    .select()
    .from(sessionTraceEntries)
    .where(
      and(
        eq(sessionTraceEntries.sessionId, input.sessionId),
        gt(sessionTraceEntries.seq, afterSeq),
      ),
    )
    .orderBy(asc(sessionTraceEntries.seq))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    sessionId: session.id,
    entries: page.map(traceRowToEvent),
    hasMore,
  };
}

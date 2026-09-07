import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { TraceEvent, TraceEventInput, TraceKind } from "@comitia/shared";
import {
  serializeTraceEvent,
  serializeTraceEvents,
  TRACE_LINE_PREFIX,
  TRACE_VERSION,
} from "@comitia/shared";
import { sessionTraceEntries, sessions } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { PermissionDenied } from "./errors.js";
import { getParticipant } from "./helpers.js";
import { getSessionById } from "./sessions.js";

const DEFAULT_TRACE_LIMIT = 500;
export const MAX_TRACE_LIMIT = 2_000;
const CHAT_LOG_PROJECT_PAGE = 200;
export const TRACE_SOURCE_MCP = "mcp";
const MCP_TRACE_JSON_LIMIT = 64 * 1024;
const MCP_BODY_REDACT_TOOLS = new Set([
  "write_note",
  "write_memory",
  "read_note",
  "comment_note",
]);

function asSeq(value: unknown): number {
  const seq = typeof value === "number" ? value : Number(value);
  return Number.isFinite(seq) ? seq : 0;
}

function notMcpSource() {
  return sql`coalesce(${sessionTraceEntries.payload}->>'source', '') <> ${TRACE_SOURCE_MCP}`;
}

async function shouldOmitMcpToolDuplicates(
  db: Db,
  sessionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ seq: sessionTraceEntries.seq })
    .from(sessionTraceEntries)
    .where(
      and(
        eq(sessionTraceEntries.sessionId, sessionId),
        inArray(sessionTraceEntries.kind, ["tool_call", "tool_result"]),
        notMcpSource(),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function truncateJson(value: unknown, limit: number): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return value;
  }
  if (serialized.length <= limit) {
    return value;
  }
  return { _truncated: true, preview: serialized.slice(0, limit) };
}

function redactMcpToolBody(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = { ...(value as Record<string, unknown>) };
  for (const key of ["body", "content", "text", "title"]) {
    if (key in record) {
      record[key] = "(redacted)";
    }
  }
  return record;
}

function sanitizeMcpPayload(tool: string, value: unknown): unknown {
  const redacted = MCP_BODY_REDACT_TOOLS.has(tool)
    ? redactMcpToolBody(value)
    : value;
  return truncateJson(redacted, MCP_TRACE_JSON_LIMIT);
}

function parseMcpToolResult(result: {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}): unknown {
  const text = result.content[0]?.text;
  if (typeof text !== "string") {
    return result.content;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

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
    seq: asSeq(row.seq),
    at: row.at.toISOString(),
    kind: row.kind as TraceKind,
    run: row.run ?? undefined,
    ...payload,
    ...(typeof adapterSeq === "number" ? { adapterSeq } : {}),
  } as TraceEvent;
}

/** Drop a leading partial line so a character-tail of @json stays parseable. */
export function alignChatLogTail(slice: string): string {
  if (!slice || slice.startsWith(TRACE_LINE_PREFIX) || !slice.includes("\n")) {
    return slice;
  }
  return slice.slice(slice.indexOf("\n") + 1);
}

/** Record a board-side MCP tool call so traces survive adapter upload loss. */
export async function recordMcpToolTrace(
  db: Db,
  input: {
    sessionId: string;
    tool: string;
    args: Record<string, unknown>;
    result: {
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    };
  },
): Promise<void> {
  const session = await getSessionById(db, input.sessionId);
  const at = new Date().toISOString();
  const isError = input.result.isError === true;
  await appendSessionTraceEntries(db, {
    sessionId: input.sessionId,
    participantId: session.participantId,
    entries: [
      {
        v: TRACE_VERSION,
        at,
        kind: "tool_call",
        tool: input.tool,
        args: sanitizeMcpPayload(input.tool, input.args),
        source: TRACE_SOURCE_MCP,
      },
      {
        v: TRACE_VERSION,
        at,
        kind: "tool_result",
        tool: input.tool,
        ok: !isError,
        isError,
        result: sanitizeMcpPayload(input.tool, parseMcpToolResult(input.result)),
        source: TRACE_SOURCE_MCP,
      },
    ],
  });
}

/**
 * Build display text from structured traces when `sessions.chat_log` is empty.
 * Phase 2 stores traces as the source of truth; chat_log is a projection.
 */
export async function buildChatLogFromTraces(
  db: Db,
  sessionId: string,
  options: { tailChars: number; fromStart: boolean },
): Promise<{ chatLog: string; truncated: boolean }> {
  const omitMcpTools = await shouldOmitMcpToolDuplicates(db, sessionId);
  if (options.fromStart) {
    const events: TraceEvent[] = [];
    let afterSeq = 0;
    let hasMore = true;
    while (hasMore) {
      const rows = await db
        .select()
        .from(sessionTraceEntries)
        .where(
          and(
            eq(sessionTraceEntries.sessionId, sessionId),
            gt(sessionTraceEntries.seq, afterSeq),
            omitMcpTools ? notMcpSource() : undefined,
          ),
        )
        .orderBy(asc(sessionTraceEntries.seq))
        .limit(CHAT_LOG_PROJECT_PAGE + 1);
      hasMore = rows.length > CHAT_LOG_PROJECT_PAGE;
      const page = hasMore ? rows.slice(0, CHAT_LOG_PROJECT_PAGE) : rows;
      if (page.length === 0) {
        break;
      }
      const lastSeq = asSeq(page.at(-1)?.seq);
      if (lastSeq <= afterSeq) {
        break;
      }
      afterSeq = lastSeq;
      events.push(...page.map(traceRowToEvent));
    }
    return { chatLog: serializeTraceEvents(events), truncated: false };
  }

  const batches: TraceEvent[][] = [];
  let beforeSeq: number | undefined;
  let serializedChars = 0;
  let hasOlder = true;
  while (hasOlder && serializedChars < options.tailChars) {
    const rows = await db
      .select()
      .from(sessionTraceEntries)
      .where(
        and(
          eq(sessionTraceEntries.sessionId, sessionId),
          beforeSeq !== undefined
            ? lt(sessionTraceEntries.seq, beforeSeq)
            : undefined,
          omitMcpTools ? notMcpSource() : undefined,
        ),
      )
      .orderBy(desc(sessionTraceEntries.seq))
      .limit(CHAT_LOG_PROJECT_PAGE);
    if (rows.length === 0) {
      hasOlder = false;
      break;
    }
    hasOlder = rows.length === CHAT_LOG_PROJECT_PAGE;
    beforeSeq = asSeq(rows[rows.length - 1]?.seq);
    const chronological = rows.map(traceRowToEvent).reverse();
    batches.unshift(chronological);
    serializedChars += chronological.reduce(
      (sum, event) => sum + serializeTraceEvent(event).length,
      0,
    );
  }
  let chatLog = serializeTraceEvents(batches.flat());
  const truncated = hasOlder || chatLog.length > options.tailChars;
  if (chatLog.length > options.tailChars) {
    chatLog = alignChatLogTail(chatLog.slice(chatLog.length - options.tailChars));
  }
  return { chatLog, truncated };
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
  const omitMcpTools = await shouldOmitMcpToolDuplicates(db, input.sessionId);

  const rows = await db
    .select()
    .from(sessionTraceEntries)
    .where(
      and(
        eq(sessionTraceEntries.sessionId, input.sessionId),
        gt(sessionTraceEntries.seq, afterSeq),
        omitMcpTools ? notMcpSource() : undefined,
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

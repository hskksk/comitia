import { describe, expect, it } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { sessionTraceEntries } from "../db/schema.js";
import { bootstrapBoard, registerAgent } from "../domain/bootstrap.js";
import { prepareSessionStart } from "../domain/sessions.js";
import {
  alignChatLogTail,
  appendSessionTraceEntries,
  buildChatLogFromTraces,
  getOwnerSessionTrace,
  recordMcpToolTrace,
  TRACE_SOURCE_MCP,
  traceRowToEvent,
} from "../domain/trace.js";

describe("session trace entries", () => {
  it("appends entries with server-assigned seq and round-trips to TraceEvent", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const agent = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "fake",
    });
    const session = await prepareSessionStart(db, {
      participantId: agent.agent.id,
      projectId: boot.project.id,
    });

    const first = await appendSessionTraceEntries(db, {
      sessionId: session.id,
      participantId: agent.agent.id,
      entries: [
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "2026-08-31T12:00:00.000Z",
          kind: "run_start",
          run: 1,
        },
        {
          v: TRACE_VERSION,
          seq: 2,
          at: "2026-08-31T12:00:01.000Z",
          kind: "tool_call",
          run: 1,
          tool: "get_briefing",
          args: {},
        },
      ],
    });
    expect(first.lastSeq).toBe(2);

    const ownerView = await getOwnerSessionTrace(db, {
      sessionId: session.id,
      actorId: boot.owner.id,
    });
    expect(ownerView.entries).toHaveLength(2);
    expect(ownerView.entries[0]?.kind).toBe("run_start");
    expect(ownerView.entries[0]?.seq).toBe(1);
    expect(ownerView.entries[0]?.adapterSeq).toBe(1);
    expect(ownerView.entries[1]?.tool).toBe("get_briefing");

    const tail = await getOwnerSessionTrace(db, {
      sessionId: session.id,
      actorId: boot.owner.id,
      afterSeq: 1,
    });
    expect(tail.entries).toHaveLength(1);
    expect(tail.entries[0]?.kind).toBe("tool_call");

    const [row] = await db
      .select()
      .from(sessionTraceEntries)
      .where(eq(sessionTraceEntries.sessionId, session.id));
    expect(traceRowToEvent(row!).seq).toBe(1);
  });

  it("pages trace entries when limit is exceeded", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const agent = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "fake",
    });
    const session = await prepareSessionStart(db, {
      participantId: agent.agent.id,
      projectId: boot.project.id,
    });

    await appendSessionTraceEntries(db, {
      sessionId: session.id,
      participantId: agent.agent.id,
      entries: [
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "2026-08-31T12:00:00.000Z",
          kind: "run_start",
          run: 1,
        },
        {
          v: TRACE_VERSION,
          seq: 2,
          at: "2026-08-31T12:00:01.000Z",
          kind: "tool_call",
          run: 1,
          tool: "get_briefing",
          args: {},
        },
        {
          v: TRACE_VERSION,
          seq: 3,
          at: "2026-08-31T12:00:02.000Z",
          kind: "run_end",
          run: 1,
        },
      ],
    });

    const firstPage = await getOwnerSessionTrace(db, {
      sessionId: session.id,
      actorId: boot.owner.id,
      afterSeq: 0,
      limit: 2,
    });
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.entries[0]?.kind).toBe("run_start");
    expect(firstPage.entries[1]?.kind).toBe("tool_call");
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await getOwnerSessionTrace(db, {
      sessionId: session.id,
      actorId: boot.owner.id,
      afterSeq: firstPage.entries[1]?.seq,
      limit: 2,
    });
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.entries[0]?.kind).toBe("run_end");
    expect(secondPage.hasMore).toBe(false);
  });

  it("projects @json chat log text from traces when chat_log is empty", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const agent = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "fake",
    });
    const session = await prepareSessionStart(db, {
      participantId: agent.agent.id,
      projectId: boot.project.id,
    });

    await appendSessionTraceEntries(db, {
      sessionId: session.id,
      participantId: agent.agent.id,
      entries: [
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "2026-08-31T12:00:00.000Z",
          kind: "run_start",
          run: 1,
        },
        {
          v: TRACE_VERSION,
          seq: 2,
          at: "2026-08-31T12:00:01.000Z",
          kind: "text",
          run: 1,
          text: "hello from trace",
        },
      ],
    });

    const projected = await buildChatLogFromTraces(db, session.id, {
      tailChars: 65_536,
      fromStart: true,
    });
    expect(projected.truncated).toBe(false);
    expect(projected.chatLog).toContain("@json ");
    expect(projected.chatLog).toContain("hello from trace");
    expect(projected.chatLog).toContain("run_start");
  });

  it("drops a partial leading line when aligning a chat log tail", () => {
    expect(alignChatLogTail("@json {\"seq\":1}\n")).toBe("@json {\"seq\":1}\n");
    expect(alignChatLogTail("ial\":\"x\"}\n@json {\"seq\":2}\n")).toBe(
      "@json {\"seq\":2}\n",
    );
  });

  it("records MCP tool traces and redacts note bodies", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const agent = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "fake",
    });
    const session = await prepareSessionStart(db, {
      participantId: agent.agent.id,
      projectId: boot.project.id,
    });

    await recordMcpToolTrace(db, {
      sessionId: session.id,
      tool: "write_note",
      args: { title: "秘密", body: "本文は残さない" },
      result: {
        content: [{ type: "text", text: JSON.stringify({ ok: true, title: "秘密" }) }],
      },
    });

    const ownerView = await getOwnerSessionTrace(db, {
      sessionId: session.id,
      actorId: boot.owner.id,
    });
    expect(ownerView.entries).toHaveLength(2);
    expect(ownerView.entries[0]?.kind).toBe("tool_call");
    expect(ownerView.entries[0]?.source).toBe(TRACE_SOURCE_MCP);
    expect(ownerView.entries[0]?.args).toMatchObject({
      title: "(redacted)",
      body: "(redacted)",
    });
    expect(ownerView.entries[1]?.kind).toBe("tool_result");
    expect(JSON.stringify(ownerView.entries[1]?.result)).not.toContain("秘密");
  });

  it("omits MCP tool traces when the adapter already uploaded tools", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const agent = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "fake",
    });
    const session = await prepareSessionStart(db, {
      participantId: agent.agent.id,
      projectId: boot.project.id,
    });

    await recordMcpToolTrace(db, {
      sessionId: session.id,
      tool: "get_briefing",
      args: {},
      result: {
        content: [{ type: "text", text: JSON.stringify({ remaining_budget: 9 }) }],
      },
    });
    await appendSessionTraceEntries(db, {
      sessionId: session.id,
      participantId: agent.agent.id,
      entries: [
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "2026-08-31T12:00:00.000Z",
          kind: "run_start",
          run: 1,
        },
        {
          v: TRACE_VERSION,
          seq: 2,
          at: "2026-08-31T12:00:01.000Z",
          kind: "tool_call",
          run: 1,
          tool: "get_briefing",
          args: {},
        },
      ],
    });

    const ownerView = await getOwnerSessionTrace(db, {
      sessionId: session.id,
      actorId: boot.owner.id,
    });
    expect(ownerView.entries.map((event) => event.kind)).toEqual([
      "run_start",
      "tool_call",
    ]);
    expect(ownerView.entries.some((event) => event.source === TRACE_SOURCE_MCP)).toBe(
      false,
    );

    const projected = await buildChatLogFromTraces(db, session.id, {
      tailChars: 65_536,
      fromStart: true,
    });
    expect(projected.chatLog).toContain("run_start");
    expect(projected.chatLog).not.toContain(`"source":"${TRACE_SOURCE_MCP}"`);
  });

  it("keeps MCP tool traces when the adapter only uploaded run events", async () => {
    const boot = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const agent = await registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "mika",
      engine: "fake",
    });
    const session = await prepareSessionStart(db, {
      participantId: agent.agent.id,
      projectId: boot.project.id,
    });

    await recordMcpToolTrace(db, {
      sessionId: session.id,
      tool: "set_goals",
      args: { goals: ["直す"] },
      result: {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      },
    });
    await appendSessionTraceEntries(db, {
      sessionId: session.id,
      participantId: agent.agent.id,
      entries: [
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "2026-08-31T12:00:00.000Z",
          kind: "text",
          run: 1,
          text: "thinking out loud",
        },
      ],
    });

    const ownerView = await getOwnerSessionTrace(db, {
      sessionId: session.id,
      actorId: boot.owner.id,
    });
    expect(ownerView.entries.map((event) => event.kind)).toEqual([
      "tool_call",
      "tool_result",
      "text",
    ]);
    expect(ownerView.entries[0]?.source).toBe(TRACE_SOURCE_MCP);
  });
});

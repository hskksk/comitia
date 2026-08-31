import { describe, expect, it } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import {
  claudeStreamLineToPartialEvents,
  ensureTraceChunkNewline,
  finalizeTraceEvent,
  parseClaudeStreamTrace,
  redactSecrets,
  TraceSessionLog,
  toolLogToTraceEvents,
} from "./trace-format.js";

describe("trace-format", () => {
  it("redacts secret tokens in strings", () => {
    expect(redactSecrets("token ghs_abc123xyz end")).toBe(
      "token [redacted] end",
    );
  });

  it("ensures trace chunks end with newline", () => {
    expect(ensureTraceChunkNewline("@json {}\n")).toBe("@json {}\n");
    expect(ensureTraceChunkNewline("@json {}")).toBe("@json {}\n");
  });

  it("parses thinking and tool_use from assistant stream lines", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "hmm" },
          {
            type: "tool_use",
            id: "tool-1",
            name: "mcp__comitia-board__get_briefing",
            input: {},
          },
        ],
      },
    });
    expect(claudeStreamLineToPartialEvents(line, 1)).toEqual([
      { kind: "thinking", run: 1, text: "hmm" },
      {
        kind: "tool_call",
        run: 1,
        tool: "get_briefing",
        args: {},
        toolUseId: "tool-1",
      },
    ]);
  });

  it("parses tool_result from user stream lines", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: [{ type: "text", text: '{"remaining_budget":3}' }],
          },
        ],
      },
    });
    expect(claudeStreamLineToPartialEvents(line, 2)).toEqual([
      {
        kind: "tool_result",
        run: 2,
        toolUseId: "tool-1",
        isError: false,
        ok: true,
        result: [{ type: "text", text: '{"remaining_budget":3}' }],
        remainingBudget: 3,
      },
    ]);
  });

  it("ignores tool_use on user stream lines", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_use",
            name: "mcp__comitia-board__get_briefing",
            input: {},
          },
        ],
      },
    });
    expect(claudeStreamLineToPartialEvents(line, 1)).toEqual([]);
  });

  it("redacts note bodies in tool_metadata mode", () => {
    const event = finalizeTraceEvent(
      {
        seq: 1,
        kind: "tool_call",
        run: 1,
        tool: "write_note",
        args: { title: "t", body: "secret" },
      },
      { redactMode: "tool_metadata" },
    );
    expect(event.args).toEqual({ title: "(redacted)", body: "(redacted)" });
    expect(event.redacted).toBe(true);
  });

  it("builds trace events from claude stdout", async () => {
    const chunks: string[] = [];
    const traceLog = new TraceSessionLog(async (chunk) => {
      chunks.push(chunk);
    });
    const output = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hello" }],
        },
      }),
    ].join("\n");
    const parsed = parseClaudeStreamTrace(output, 1, traceLog);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.kind).toBe("text");
    await traceLog.flush(parsed.events);
    expect(chunks[0]).toContain('"kind":"text"');
    expect(chunks[0]?.endsWith("\n")).toBe(true);
  });

  it("truncates oversized thinking text", () => {
    const event = finalizeTraceEvent({
      seq: 1,
      kind: "thinking",
      run: 1,
      text: "x".repeat(40_000),
    });
    expect(event.truncated).toBe(true);
    expect(String(event.text).length).toBeLessThan(40_000);
  });

  it("maps fake toolLog entries to trace events", () => {
    const traceLog = new TraceSessionLog(async () => undefined);
    const events = toolLogToTraceEvents(
      1,
      [{ tool: "get_briefing", args: {}, result: { ok: true } }],
      traceLog,
    );
    expect(events.map((event) => event.kind)).toEqual([
      "tool_call",
      "tool_result",
    ]);
    expect(events[0]?.v).toBe(TRACE_VERSION);
  });
});

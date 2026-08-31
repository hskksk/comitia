import { describe, expect, it } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import {
  claudeStreamLineToPartialEvents,
  parseClaudeStreamTrace,
  TraceSessionLog,
} from "./trace-format.js";

describe("claude live trace streaming", () => {
  it("parseClaudeStreamTrace with recordEvents:false does not re-emit", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hello" }],
      },
    });
    const emitted: string[] = [];
    const traceLog = new TraceSessionLog(
      async (chunk) => {
        emitted.push(chunk);
      },
      { live: true },
    );

    traceLog.emit(
      claudeStreamLineToPartialEvents(line, 1)[0] ?? {
        kind: "text",
        run: 1,
        text: "fallback",
      },
    );

    const parsed = parseClaudeStreamTrace(line, 1, traceLog, {
      recordEvents: false,
    });
    expect(parsed.events).toHaveLength(0);
    expect(parsed.toolLog).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it("TraceSessionLog live mode coalesces emitted stream events", async () => {
    const chunks: string[] = [];
    const traceLog = new TraceSessionLog(
      async (chunk) => {
        chunks.push(chunk);
      },
      { live: true, coalesce: { maxEvents: 1, maxMs: 60_000 } },
    );

    traceLog.emit({ kind: "run_start", run: 1 });
    await traceLog.flushPending();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('"kind":"run_start"');
    expect(chunks[0]).toContain(`"v":${TRACE_VERSION}`);
  });

  it("live emit followed by flush does not duplicate adapter notes", async () => {
    const chunks: string[] = [];
    const traceLog = new TraceSessionLog(
      async (chunk) => {
        chunks.push(chunk);
      },
      { live: true, coalesce: { maxEvents: 10, maxMs: 60_000 } },
    );

    traceLog.emit({ kind: "adapter_note", run: 1, message: "checkout failed" });
    await traceLog.flush([
      {
        v: TRACE_VERSION,
        seq: 1,
        at: "2026-08-31T12:00:00.000Z",
        kind: "adapter_note",
        run: 1,
        message: "checkout failed",
      },
    ]);
    await traceLog.flushPending();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.match(/"kind":"adapter_note"/g)).toHaveLength(1);
  });
});

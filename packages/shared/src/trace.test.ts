import { describe, expect, it } from "vitest";
import {
  formatTraceHuman,
  parseTraceLine,
  serializeTraceEvent,
  serializeTraceEvents,
  TRACE_VERSION,
} from "./trace.js";

describe("trace", () => {
  it("round-trips trace events", () => {
    const event = {
      v: TRACE_VERSION,
      seq: 1,
      at: "2026-08-31T11:00:00.000Z",
      kind: "thinking" as const,
      run: 2,
      text: "hmm",
    };
    const line = serializeTraceEvent(event);
    expect(line.startsWith("@json ")).toBe(true);
    expect(line.endsWith("\n")).toBe(true);
    expect(parseTraceLine(line.trimEnd())).toEqual(event);
  });

  it("serializes multiple events with trailing newline", () => {
    const chunk = serializeTraceEvents([
      {
        v: TRACE_VERSION,
        seq: 1,
        at: "2026-08-31T11:00:00.000Z",
        kind: "run_start",
        run: 1,
      },
      {
        v: TRACE_VERSION,
        seq: 2,
        at: "2026-08-31T11:00:01.000Z",
        kind: "tool_call",
        run: 1,
        tool: "get_briefing",
        args: {},
      },
    ]);
    expect(chunk.endsWith("\n")).toBe(true);
    expect(chunk.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("formats human-readable lines", () => {
    expect(
      formatTraceHuman({
        v: TRACE_VERSION,
        seq: 1,
        at: "2026-08-31T11:00:00.000Z",
        kind: "thinking",
        run: 1,
        text: "considering",
      }),
    ).toBe("[thinking] considering");
  });
});

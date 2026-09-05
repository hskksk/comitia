import { describe, expect, it } from "vitest";
import {
  describeTraceEvent,
  formatTraceHuman,
  formatTraceHumanList,
  parseTraceLine,
  prettyTraceValue,
  serializeTraceEvent,
  serializeTraceEvents,
  TRACE_VERSION,
  unwrapTraceValue,
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

  it("formats short thinking on one line", () => {
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

  it("pretty-prints tool args on following lines", () => {
    expect(
      formatTraceHuman({
        v: TRACE_VERSION,
        seq: 2,
        at: "2026-08-31T11:00:01.000Z",
        kind: "tool_call",
        run: 1,
        tool: "get_briefing",
        args: { foo: "bar", nested: { n: 1 } },
      }),
    ).toBe(
      [
        "[tool] get_briefing",
        "{",
        '  "foo": "bar",',
        '  "nested": {',
        '    "n": 1',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("omits empty tool args from the human line", () => {
    expect(
      formatTraceHuman({
        v: TRACE_VERSION,
        seq: 3,
        at: "2026-08-31T11:00:02.000Z",
        kind: "tool_call",
        run: 1,
        tool: "get_briefing",
        args: {},
      }),
    ).toBe("[tool] get_briefing");
  });

  it("unwraps MCP text blocks and shows tool result bodies", () => {
    expect(
      formatTraceHuman({
        v: TRACE_VERSION,
        seq: 4,
        at: "2026-08-31T11:00:03.000Z",
        kind: "tool_result",
        run: 1,
        tool: "get_briefing",
        ok: true,
        remainingBudget: 820,
        result: [{ type: "text", text: '{"remaining_budget":3,"you":{"name":"mika"}}' }],
      }),
    ).toBe(
      [
        "[tool-result] get_briefing ok remaining=820",
        "{",
        '  "remaining_budget": 3,',
        '  "you": {',
        '    "name": "mika"',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("pretty-prints tool result errors", () => {
    expect(
      formatTraceHuman({
        v: TRACE_VERSION,
        seq: 5,
        at: "2026-08-31T11:00:04.000Z",
        kind: "tool_result",
        run: 1,
        tool: "read_thread",
        isError: true,
        result: { message: "not found" },
      }),
    ).toBe(
      ['[tool-result] read_thread ERROR', "{", '  "message": "not found"', "}"].join(
        "\n",
      ),
    );
  });

  it("inserts a blank line before a new run", () => {
    expect(
      formatTraceHumanList([
        {
          v: TRACE_VERSION,
          seq: 1,
          at: "t1",
          kind: "run_end",
          run: 1,
          tokens: 10,
        },
        {
          v: TRACE_VERSION,
          seq: 2,
          at: "t2",
          kind: "run_start",
          run: 2,
          remainingBudget: 9,
        },
      ]),
    ).toBe("[run end] n=1 tokens=10\n\n[run start] n=2 remaining=9\n");
  });

  it("unwraps nested JSON strings and MCP text blocks", () => {
    expect(unwrapTraceValue('{"a":1}')).toEqual({ a: 1 });
    expect(
      unwrapTraceValue([{ type: "text", text: '{"remaining_budget":3}' }]),
    ).toEqual({ remaining_budget: 3 });
    expect(prettyTraceValue({})).toBeNull();
    expect(prettyTraceValue({ z: 2, a: 1 })).toBe('{\n  "z": 2,\n  "a": 1\n}');
  });

  it("describes continue_decision goals as a body", () => {
    expect(
      describeTraceEvent({
        v: TRACE_VERSION,
        seq: 6,
        at: "t",
        kind: "continue_decision",
        run: 1,
        action: "continue",
        reason: "goals_incomplete",
        incompleteGoals: ["スレッドAを読む"],
      }),
    ).toEqual({
      kind: "continue_decision",
      headline: "[adapter] continue: goals_incomplete",
      body: '[\n  "スレッドAを読む"\n]',
    });
  });
});

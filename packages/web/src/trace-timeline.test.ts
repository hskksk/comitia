import { TRACE_VERSION } from "@comitia/shared";
import { describe, expect, it } from "vitest";
import {
  filterTimelineItems,
  filterTraceEntries,
  isTraceResultError,
  traceEntryBody,
  traceEntryStatus,
  traceEntryTitle,
} from "./trace-timeline.js";

describe("trace-timeline", () => {
  const entries = [
    {
      v: TRACE_VERSION,
      seq: 1,
      at: "t1",
      kind: "thinking" as const,
      run: 1,
      text: "hmm",
    },
    {
      v: TRACE_VERSION,
      seq: 2,
      at: "t2",
      kind: "tool_call" as const,
      run: 1,
      tool: "get_briefing",
      args: { threadId: "abc" },
    },
  ];

  it("hides thinking when hideThinking is set", () => {
    expect(
      filterTraceEntries(entries, { hideThinking: true, toolsOnly: false }),
    ).toHaveLength(1);
  });

  it("shows only tool events in toolsOnly mode", () => {
    expect(
      filterTraceEntries(entries, { hideThinking: false, toolsOnly: true }),
    ).toEqual([entries[1]]);
  });

  it("keeps legacy lines unless toolsOnly", () => {
    const items = [
      { type: "legacy" as const, text: "old" },
      { type: "trace" as const, event: entries[0]! },
      { type: "trace" as const, event: entries[1]! },
    ];
    expect(
      filterTimelineItems(items, { hideThinking: false, toolsOnly: true }),
    ).toEqual([{ type: "trace", event: entries[1]! }]);
  });

  it("pretty-prints tool args as the body", () => {
    expect(traceEntryTitle(entries[1]!)).toBe("get_briefing");
    expect(traceEntryBody(entries[1]!)).toBe('{\n  "threadId": "abc"\n}');
  });

  it("unwraps MCP tool results and flags errors", () => {
    const ok = {
      v: TRACE_VERSION,
      seq: 3,
      at: "t3",
      kind: "tool_result" as const,
      run: 1,
      tool: "get_briefing",
      ok: true,
      remainingBudget: 12,
      result: [{ type: "text", text: '{"you":{"name":"mika"}}' }],
    };
    expect(traceEntryStatus(ok)).toBe("ok · 残量 12");
    expect(traceEntryBody(ok)).toBe('{\n  "you": {\n    "name": "mika"\n  }\n}');
    expect(isTraceResultError(ok)).toBe(false);

    const failed = {
      ...ok,
      seq: 4,
      isError: true,
      ok: false,
      result: { message: "boom" },
    };
    expect(traceEntryStatus(failed)).toBe("エラー");
    expect(isTraceResultError(failed)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import { filterTraceEntries } from "./trace-timeline.js";

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
      args: {},
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
});

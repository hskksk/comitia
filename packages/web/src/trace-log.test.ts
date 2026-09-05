import { describe, expect, it } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import { parseChatLogLines, traceKindClass } from "./trace-log.js";

describe("trace-log", () => {
  it("parses @json trace lines and legacy text", () => {
    const chatLog = [
      "legacy line",
      `@json ${JSON.stringify({
        v: TRACE_VERSION,
        seq: 1,
        at: "2026-08-31T11:00:00.000Z",
        kind: "thinking",
        run: 1,
        text: "hmm",
      })}`,
    ].join("\n");
    const parsed = parseChatLogLines(chatLog);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ type: "legacy", text: "legacy line" });
    expect(parsed[1]?.type).toBe("trace");
  });

  it("maps trace kinds to css classes", () => {
    expect(traceKindClass("thinking")).toBe("trace-thinking");
    expect(traceKindClass("text")).toBe("trace-text");
    expect(traceKindClass("tool_call")).toBe("trace-tool-call");
  });
});

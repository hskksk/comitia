import { describe, expect, it } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import {
  formatChatLogDelta,
  formatChatLogForDisplay,
  formatChatLogLine,
} from "./chat-log-display.js";

describe("chat-log-display", () => {
  const traceLine = `@json ${JSON.stringify({
    v: TRACE_VERSION,
    seq: 1,
    at: "2026-08-31T11:00:00.000Z",
    kind: "tool_call",
    run: 1,
    tool: "get_briefing",
    args: {},
  })}`;

  it("formats @json trace lines for human display", () => {
    expect(formatChatLogLine(traceLine, false)).toBe(
      "[tool] get_briefing",
    );
  });

  it("passes through raw @json lines", () => {
    expect(formatChatLogLine(traceLine, true)).toBe(traceLine);
  });

  it("formats a mixed chat log blob", () => {
    const chatLog = ["legacy note", traceLine].join("\n");
    expect(formatChatLogForDisplay(chatLog, false)).toBe(
      "legacy note\n[tool] get_briefing\n",
    );
  });

  it("formats follow deltas without re-processing prior lines", () => {
    const delta = `@json ${JSON.stringify({
      v: TRACE_VERSION,
      seq: 2,
      at: "2026-08-31T11:00:01.000Z",
      kind: "thinking",
      run: 1,
      text: "hmm",
    })}\n`;
    expect(formatChatLogDelta(delta, false)).toBe("[thinking] hmm\n");
  });

  it("pretty-prints tool args in the human blob", () => {
    const chatLog = `@json ${JSON.stringify({
      v: TRACE_VERSION,
      seq: 3,
      at: "2026-08-31T11:00:02.000Z",
      kind: "tool_call",
      run: 1,
      tool: "read_thread",
      args: { threadId: "t1" },
    })}`;
    expect(formatChatLogForDisplay(chatLog, false)).toBe(
      '[tool] read_thread\n{\n  "threadId": "t1"\n}\n',
    );
  });
});

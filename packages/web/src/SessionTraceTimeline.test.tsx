import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import { SessionTraceTimeline } from "./SessionTraceTimeline.js";

describe("SessionTraceTimeline", () => {
  afterEach(cleanup);

  it("renders kind labels, pretty JSON, and tool result bodies", () => {
    render(
      <SessionTraceTimeline
        filters={{ hideThinking: false, toolsOnly: false }}
        items={[
          {
            type: "trace",
            event: {
              v: TRACE_VERSION,
              seq: 1,
              at: "2026-08-31T11:23:05.118Z",
              kind: "tool_call",
              run: 2,
              tool: "get_briefing",
              args: { foo: "bar" },
            },
          },
          {
            type: "trace",
            event: {
              v: TRACE_VERSION,
              seq: 2,
              at: "2026-08-31T11:23:07.220Z",
              kind: "tool_result",
              run: 2,
              tool: "get_briefing",
              ok: true,
              remainingBudget: 820,
              result: [{ type: "text", text: '{"you":{"name":"mika"}}' }],
            },
          },
          {
            type: "trace",
            event: {
              v: TRACE_VERSION,
              seq: 3,
              at: "2026-08-31T11:23:08.004Z",
              kind: "text",
              run: 2,
              text: "ブリーフィングを確認した。",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("ツール")).toBeInTheDocument();
    expect(screen.getAllByText("get_briefing")).toHaveLength(2);
    expect(screen.getByText(/"foo": "bar"/)).toBeInTheDocument();
    expect(screen.getByText("結果")).toBeInTheDocument();
    expect(screen.getByText("ok · 残量 820")).toBeInTheDocument();
    expect(screen.getByText(/"name": "mika"/)).toBeInTheDocument();
    expect(screen.getByText("応答")).toBeInTheDocument();
    expect(screen.getByText("ブリーフィングを確認した。")).toBeInTheDocument();
    expect(screen.queryByText("@json")).not.toBeInTheDocument();
  });

  it("marks tool errors", () => {
    render(
      <SessionTraceTimeline
        filters={{ hideThinking: false, toolsOnly: false }}
        items={[
          {
            type: "trace",
            event: {
              v: TRACE_VERSION,
              seq: 1,
              at: "2026-08-31T11:00:00.000Z",
              kind: "tool_result",
              run: 1,
              tool: "read_thread",
              isError: true,
              result: { message: "not found" },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("エラー")).toBeInTheDocument();
    expect(screen.getByText(/"message": "not found"/)).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveClass("is-error");
  });
});

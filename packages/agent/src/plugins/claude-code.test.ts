import { describe, expect, it } from "vitest";
import { buildClaudeArgs, parseClaudeStream } from "./claude-code.js";

describe("buildClaudeArgs", () => {
  it("uses isolated MCP with bypass permissions and stream JSON", () => {
    expect(
      buildClaudeArgs({
        prompt: "work on the briefing",
        mcpConfigPath: "/tmp/mcp-config.json",
        hasBare: false,
      }),
    ).toEqual([
      "-p",
      "work on the briefing",
      "--mcp-config",
      "/tmp/mcp-config.json",
      "--strict-mcp-config",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("uses --bare when the installed Claude CLI supports it", () => {
    expect(
      buildClaudeArgs({
        prompt: "continue",
        mcpConfigPath: "/tmp/mcp-config.json",
        hasBare: true,
      }),
    ).toContain("--bare");
  });
});


describe("parseClaudeStream", () => {
  it("extracts assistant text and normalizes MCP tool names", () => {
    const output = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "briefing loaded" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "mcp__comitia-board__get_briefing",
              input: {},
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: [{ type: "text", text: '{"remaining_budget":7}' }],
            },
          ],
        },
      }),
    ].join("\n");

    expect(parseClaudeStream(output, 2)).toMatchObject({
      transcript: "briefing loaded",
      remainingBudget: 7,
      toolLog: [{ run: 2, tool: "get_briefing", args: {} }],
    });
  });
});

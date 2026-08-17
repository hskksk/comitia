import { describe, expect, it } from "vitest";
import type { McpProxyToolResult } from "../mcp-proxy.js";
import { createClaudeCodePlugin } from "./claude-code.js";
import { createEnginePlugin } from "./create-engine.js";
import { createFakeEnginePlugin } from "./fake.js";
import {
  createInteractiveFakeEnginePlugin,
  createScriptedIo,
} from "./interactive-fake.js";

const GOAL_ID = "11111111-1111-4111-8111-111111111111";

function jsonResult(body: unknown, isError = false): McpProxyToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    ...(isError ? { isError: true } : {}),
  };
}

describe("createEnginePlugin", () => {
  it("uses the interactive fake engine for --engine fake", () => {
    const plugin = createEnginePlugin({
      engine: "fake",
      callTool: async () => jsonResult({}),
      io: createScriptedIo([]).io,
    });
    expect(plugin.start).toBeTypeOf("function");
  });

  it("keeps the scripted fake when COMITIA_FAKE_ENGINE-style override is set", async () => {
    const scripted = createFakeEnginePlugin({
      script: [{ tool: "get_briefing", args: {} }],
      callTool: async () => jsonResult({ remaining_budget: 9 }),
    });
    const viaFactory = createEnginePlugin({
      engine: "claude-code",
      scriptedFake: true,
      callTool: async () => jsonResult({ remaining_budget: 9 }),
    });
    expect(viaFactory.run).toBeTypeOf("function");
    expect(scripted.run).toBeTypeOf("function");
    expect(createClaudeCodePlugin().run).toBeTypeOf("function");
  });

  it("rejects unsupported engines", () => {
    expect(() =>
      createEnginePlugin({
        engine: "opencode",
        callTool: async () => jsonResult({}),
      }),
    ).toThrow(/Unsupported engine/);
  });
});

describe("interactive fake engine", () => {
  it("walks a day: briefing, goals, then wind-down end_session", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const scripted = createScriptedIo([
      "1",
      "2",
      "",
      "typo を直す",
      "",
      "done",
      "end",
      "",
      "申し送り: 目標を宣言した",
    ]);
    const plugin = createInteractiveFakeEnginePlugin({
      io: scripted.io,
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_briefing") {
          return jsonResult({ remaining_budget: 990, handover: "昨日の続き" });
        }
        if (name === "set_goals") {
          return jsonResult({
            ok: true,
            remaining_budget: 985,
            goals: [{ id: GOAL_ID, text: "typo を直す", status: "open" }],
          });
        }
        if (name === "end_session") {
          return jsonResult({ ok: true, remaining_budget: 0 });
        }
        return jsonResult({ ok: true });
      },
    });

    await plugin.start({
      sessionId: "sess-walk",
      workDir: "/tmp/walk",
      mcp: { command: "node", args: [], env: {} },
    });

    const work = await plugin.run(
      "comitia ボード MCP が利用可能。次の順で進めよ。\n1. get_briefing を呼ぶ",
    );
    expect(calls.map((call) => call.name)).toEqual([
      "get_briefing",
      "set_goals",
    ]);
    expect(calls[1]?.args).toEqual({ goals: ["typo を直す"] });
    expect(work.remainingBudget).toBe(985);
    expect(work.toolLog.map((entry) => entry.tool)).toEqual([
      "get_briefing",
      "set_goals",
    ]);
    expect(work.transcript).toContain("[fake run 1]");
    expect(work.transcript).toContain("get_briefing");

    const windDown = await plugin.run(
      "セッション終了作業。理由: 目標完了\nend_session を申し送り付きで呼べ。",
    );
    expect(calls.at(-1)).toEqual({
      name: "end_session",
      args: { handover: "申し送り: 目標を宣言した" },
    });
    expect(windDown.remainingBudget).toBe(0);
    expect(windDown.toolLog.map((entry) => entry.tool)).toEqual(["end_session"]);

    const output = scripted.output();
    expect(output).toContain("人間がエージェントの一日を操作します");
    expect(output).toContain("終了作業です");
    expect(output).toContain("ツール > ");
    expect(output).toContain("remaining_budget\": 990");
    expect(output).toContain("残量: 985");

    await plugin.stop();
    expect((await plugin.report()).tokens).toBeGreaterThan(0);
  });

  it("retries unknown input and keeps the run open after a tool error", async () => {
    const scripted = createScriptedIo(["nope", "get_briefing", "done"]);
    const plugin = createInteractiveFakeEnginePlugin({
      io: scripted.io,
      callTool: async (name) => {
        if (name === "get_briefing") {
          return {
            content: [{ type: "text", text: "根拠必須" }],
            isError: true,
          };
        }
        return jsonResult({});
      },
    });
    await plugin.start({
      sessionId: "sess-err",
      workDir: "/tmp/err",
      mcp: { command: "node", args: [], env: {} },
    });
    const result = await plugin.run("1. get_briefing を呼ぶ");
    expect(result.toolLog).toEqual([
      expect.objectContaining({ tool: "get_briefing", isError: true }),
    ]);
    expect(scripted.output()).toContain("未知の入力です");
    expect(scripted.output()).toContain("エラー:");
    await plugin.stop();
  });

  it("lets complete_goal pick a remembered goal by index", async () => {
    const scripted = createScriptedIo([
      "json set_goals {\"goals\":[\"typo\"]}",
      "complete_goal",
      "",
      "1",
      "done",
    ]);
    const plugin = createInteractiveFakeEnginePlugin({
      io: scripted.io,
      callTool: async (name, args) => {
        if (name === "set_goals") {
          return jsonResult({
            remaining_budget: 10,
            goals: [{ id: GOAL_ID, text: "typo", status: "open" }],
          });
        }
        if (name === "complete_goal") {
          return jsonResult({
            remaining_budget: 5,
            goal_id: args?.goal_id,
            status: "completed",
          });
        }
        return jsonResult({});
      },
    });
    await plugin.start({
      sessionId: "sess-goal",
      workDir: "/tmp/goal",
      mcp: { command: "node", args: [], env: {} },
    });
    const result = await plugin.run("続きに取り組め");
    expect(result.toolLog[1]).toMatchObject({
      tool: "complete_goal",
      args: { goal_id: GOAL_ID },
    });
    await plugin.stop();
  });
});

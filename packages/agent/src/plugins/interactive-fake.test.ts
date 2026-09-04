import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { McpProxyToolResult } from "../mcp-proxy.js";
import { createClaudeCodePlugin } from "./claude-code.js";
import { createEnginePlugin } from "./create-engine.js";
import { createFakeEnginePlugin } from "./fake.js";
import { ESCAPE_LINE } from "./board-tools.js";
import { TraceSessionLog } from "../trace-format.js";
import {
  askOnTty,
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
        engine: "antigravity",
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
      "3",
      "",
      "typo を直す",
      "",
      "done",
      'json end_session {"handover":"申し送り: 目標を宣言した"}',
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
      workDirPersistent: false,
      environmentPrompt:
        "あなたは ウォーカー@ハル である。Comitia に接続された自律的な参加者だ。",
      mcp: { command: "node", args: [], env: {} },
    });

    const traceLog = new TraceSessionLog(async () => undefined);
    const work = await plugin.run(
      "comitia ボード MCP が利用可能。次の順で進めよ。\n1. get_briefing を呼ぶ",
      { run: 1, trace: traceLog },
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
    expect(work.traceEvents?.map((event) => event.kind)).toEqual([
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
    ]);
    expect(work.traceEvents?.[0]?.tool).toBe("get_briefing");

    const windDown = await plugin.run(
      "セッション終了作業。理由: 目標完了\nend_session を申し送り付きで呼べ。",
      { run: 2, trace: traceLog },
    );
    expect(calls.at(-1)).toEqual({
      name: "end_session",
      args: { handover: "申し送り: 目標を宣言した" },
    });
    expect(windDown.remainingBudget).toBe(0);
    expect(windDown.toolLog.map((entry) => entry.tool)).toEqual(["end_session"]);

    const output = scripted.output();
    expect(output).toContain("ウォーカー@ハル");
    expect(output).toContain("Comitia に接続された自律的な参加者");
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
      workDirPersistent: false,
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
      workDirPersistent: false,
      mcp: { command: "node", args: [], env: {} },
    });
    const result = await plugin.run("続きに取り組め");
    expect(result.toolLog[1]).toMatchObject({
      tool: "complete_goal",
      args: { goal_id: GOAL_ID },
    });
    await plugin.stop();
  });

  it("cancels a selected tool with Escape and returns to the menu", async () => {
    const calls: string[] = [];
    const scripted = createScriptedIo([
      "2",
      ESCAPE_LINE,
      "1",
      "done",
    ]);
    const plugin = createInteractiveFakeEnginePlugin({
      io: scripted.io,
      callTool: async (name) => {
        calls.push(name);
        return jsonResult({ remaining_budget: 9 });
      },
    });
    await plugin.start({
      sessionId: "sess-esc",
      workDir: "/tmp/esc",
      workDirPersistent: false,
      mcp: { command: "node", args: [], env: {} },
    });
    const result = await plugin.run("1. get_briefing を呼ぶ");
    expect(calls).toEqual(["get_briefing"]);
    expect(result.toolLog.map((entry) => entry.tool)).toEqual(["get_briefing"]);
    expect(scripted.output()).toContain("キャンセルしました");
    await plugin.stop();
  });

  it("prints toolset help and a single-tool help page", async () => {
    const scripted = createScriptedIo([
      "help",
      "help create_thread",
      "help post",
      "help nope",
      "done",
    ]);
    const plugin = createInteractiveFakeEnginePlugin({
      io: scripted.io,
      callTool: async () => jsonResult({}),
    });
    await plugin.start({
      sessionId: "sess-help",
      workDir: "/tmp/help",
      workDirPersistent: false,
      mcp: { command: "node", args: [], env: {} },
    });
    await plugin.run("続きに取り組め");
    const output = scripted.output();
    expect(output).toContain("help で一日の流れと一覧");
    expect(output).toContain("三つを混ぜない");
    expect(output).toContain("=== create_thread ===");
    expect(output).toContain("門の「きっかけ」");
    expect(output).toContain("=== post ===");
    expect(output).toContain("提案エンティティも状態遷移も作れない");
    expect(output).toContain("ツールが見つかりません: nope");
    await plugin.stop();
  });

  it("ignores Escape on the tool menu", async () => {
    const scripted = createScriptedIo([ESCAPE_LINE, "done"]);
    const plugin = createInteractiveFakeEnginePlugin({
      io: scripted.io,
      callTool: async () => jsonResult({}),
    });
    await plugin.start({
      sessionId: "sess-esc-menu",
      workDir: "/tmp/esc-menu",
      workDirPersistent: false,
      mcp: { command: "node", args: [], env: {} },
    });
    const result = await plugin.run("続きに取り組め");
    expect(result.toolLog).toEqual([]);
    expect(scripted.output()).toContain("戻る先はありません");
    await plugin.stop();
  });
});

describe("askOnTty", () => {
  function fakeStdin(): NodeJS.ReadStream {
    const stdin = new PassThrough() as PassThrough & {
      isRaw: boolean;
      setRawMode: (mode: boolean) => NodeJS.ReadStream;
    };
    stdin.isRaw = false;
    stdin.setRawMode = function setRawMode(mode: boolean) {
      this.isRaw = mode;
      return this as unknown as NodeJS.ReadStream;
    };
    return stdin as unknown as NodeJS.ReadStream;
  }

  it("resolves Escape immediately as cancel", async () => {
    const stdin = fakeStdin();
    const stdout = new PassThrough();
    const pending = askOnTty(stdin, stdout, "q: ");
    stdin.emit("keypress", "\x1b", { name: "escape" });
    await expect(pending).resolves.toBe(ESCAPE_LINE);
  });

  it("submits the buffer on Enter", async () => {
    const stdin = fakeStdin();
    const stdout = new PassThrough();
    const pending = askOnTty(stdin, stdout, "q: ");
    stdin.emit("keypress", "hi", { name: "h" });
    stdin.emit("keypress", undefined, { name: "return" });
    await expect(pending).resolves.toBe("hi");
  });
});

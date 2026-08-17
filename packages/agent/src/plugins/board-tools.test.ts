import { describe, expect, it } from "vitest";
import { MCP_PROXY_TOOLS } from "../mcp-proxy.js";
import {
  BOARD_TOOLS,
  applyToolSideEffects,
  formatToolMenu,
  parseRunCommand,
  promptToolArgs,
} from "./board-tools.js";

describe("board tool catalog", () => {
  it("covers every MCP proxy tool", () => {
    expect(BOARD_TOOLS.map((tool) => tool.name)).toEqual([...MCP_PROXY_TOOLS]);
  });

  it("lists tools and the done / end shortcuts", () => {
    const menu = formatToolMenu();
    expect(menu).toContain("get_briefing");
    expect(menu).toContain("end_session");
    expect(menu).toContain("done");
    expect(menu).toContain("end_session");
  });
});

describe("parseRunCommand", () => {
  it("parses index, name, done, help, end, and JSON args", () => {
    expect(parseRunCommand("1")).toEqual({ kind: "tool", name: "get_briefing" });
    expect(parseRunCommand("set_goals")).toEqual({
      kind: "tool",
      name: "set_goals",
    });
    expect(parseRunCommand("done")).toEqual({ kind: "done" });
    expect(parseRunCommand("0")).toEqual({ kind: "done" });
    expect(parseRunCommand("help")).toEqual({ kind: "help" });
    expect(parseRunCommand("end")).toEqual({
      kind: "tool",
      name: "end_session",
    });
    expect(
      parseRunCommand('json set_goals {"goals":["typo"]}'),
    ).toEqual({
      kind: "tool",
      name: "set_goals",
      args: { goals: ["typo"] },
    });
    expect(parseRunCommand('post {"thread_id":"t"}')).toEqual({
      kind: "tool",
      name: "post",
      args: { thread_id: "t" },
    });
    expect(parseRunCommand("nope").kind).toBe("error");
    expect(parseRunCommand("").kind).toBe("error");
  });
});

describe("promptToolArgs", () => {
  it("collects a string array field by field", async () => {
    const lines = ["", "typo を直す", "report を書く", ""];
    let index = 0;
    const written: string[] = [];
    const args = await promptToolArgs(
      BOARD_TOOLS.find((tool) => tool.name === "set_goals")!,
      async () => lines[index++]!,
      (text) => {
        written.push(text);
      },
      { goals: [] },
    );
    expect(args).toEqual({ goals: ["typo を直す", "report を書く"] });
    expect(written.join("")).toContain("set_goals");
  });

  it("accepts bulk JSON instead of field prompts", async () => {
    const args = await promptToolArgs(
      BOARD_TOOLS.find((tool) => tool.name === "complete_goal")!,
      async () => '{"goal_id":"11111111-1111-4111-8111-111111111111"}',
      () => undefined,
      { goals: [] },
    );
    expect(args).toEqual({
      goal_id: "11111111-1111-4111-8111-111111111111",
    });
  });
});

describe("applyToolSideEffects", () => {
  it("tracks goals and the last created thread", () => {
    const afterGoals = applyToolSideEffects(
      "set_goals",
      {
        goals: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            text: "typo",
            status: "open",
          },
        ],
      },
      { goals: [] },
    );
    expect(afterGoals.goals).toHaveLength(1);
    const afterThread = applyToolSideEffects(
      "create_thread",
      { thread_id: "22222222-2222-4222-8222-222222222222" },
      afterGoals,
    );
    expect(afterThread.lastThreadId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    const afterComplete = applyToolSideEffects(
      "complete_goal",
      { goal_id: "11111111-1111-4111-8111-111111111111" },
      afterThread,
    );
    expect(afterComplete.goals).toEqual([]);
  });
});

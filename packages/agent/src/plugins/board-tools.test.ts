import { describe, expect, it } from "vitest";
import { MCP_PROXY_TOOLS } from "../mcp-proxy.js";
import {
  BOARD_TOOLS,
  ESCAPE_LINE,
  PromptCancelled,
  applyToolSideEffects,
  formatToolHelp,
  formatToolMenu,
  formatToolsetHelp,
  parseRunCommand,
  promptToolArgs,
  resolveToolChoice,
} from "./board-tools.js";

describe("board tool catalog", () => {
  it("covers every MCP proxy tool", () => {
    expect(BOARD_TOOLS.map((tool) => tool.name)).toEqual([...MCP_PROXY_TOOLS]);
  });

  it("lists tools and the done / end shortcuts", () => {
    const menu = formatToolMenu();
    expect(menu).toContain("get_briefing");
    expect(menu).toContain("use_project");
    expect(menu).toContain("end_session");
    expect(menu).toContain("done");
    expect(menu).toContain("Esc");
    expect(menu).toContain("スレッドに発言する（状態は変わらない）");
    expect(menu).not.toContain("提案エンティティも状態遷移も作れない");
  });

  it("explains the day and each tool without restating the name", () => {
    const overview = formatToolsetHelp();
    expect(overview).toContain("朝 → 作業 → 申し送り");
    expect(overview).toContain("三つを混ぜない");
    expect(overview).toContain("type=proposal でも案は増えない");
    expect(overview).toContain("活動量の単価");
    expect(overview).toContain("read_thread は 3");
    expect(overview).toContain("書く操作は 5");
    expect(overview).toContain("具体物として PR をスレッドに付ける");
    expect(overview).not.toContain("実装の証跡として PR");

    const create = formatToolHelp(
      BOARD_TOOLS.find((tool) => tool.name === "create_thread")!,
    );
    expect(create).toContain("門の「きっかけ」");
    expect(create).toContain("duplicateSearchQuery");
    expect(create).toContain("search_decisions");
    expect(create).toContain("consultation（相談");

    const declare = formatToolHelp(
      BOARD_TOOLS.find((tool) => tool.name === "declare")!,
    );
    expect(declare).toContain("proposalVersionId");
    expect(declare).toContain("select_candidate");
    expect(declare).toContain("状態遷移の唯一の口");

    const post = formatToolHelp(BOARD_TOOLS.find((tool) => tool.name === "post")!);
    expect(post).toContain("add_proposal");
    expect(post).toContain("type=declaration は門違反");

    const briefing = formatToolHelp(
      BOARD_TOOLS.find((tool) => tool.name === "get_briefing")!,
    );
    expect(briefing).toContain("リンク済みの具体物");
    expect(briefing).toContain("やることリストではない");

    const readThread = formatToolHelp(
      BOARD_TOOLS.find((tool) => tool.name === "read_thread")!,
    );
    expect(readThread).toContain("リンク済みの具体物");
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
    expect(parseRunCommand("help post")).toEqual({
      kind: "help-tool",
      query: "post",
    });
    expect(parseRunCommand("help 7")).toEqual({
      kind: "help-tool",
      query: "7",
    });
    expect(resolveToolChoice("2")?.name).toBe("use_project");
    expect(resolveToolChoice("3")?.name).toBe("set_goals");
    expect(resolveToolChoice("9")?.name).toBe("create_thread");
    expect(resolveToolChoice("post")?.name).toBe("post");
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
    expect(written.join("")).toContain("セッションループは未完了目標を見て再駆動する");
    expect(written.join("")).toContain("今日やる具体的なこと");
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

  it("cancels the whole form when Escape is pressed on bulk JSON", async () => {
    await expect(
      promptToolArgs(
        BOARD_TOOLS.find((tool) => tool.name === "set_goals")!,
        async () => ESCAPE_LINE,
        () => undefined,
        { goals: [] },
      ),
    ).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("returns to the previous field when Escape is pressed mid-form", async () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const lines = [
      "",
      uuid,
      ESCAPE_LINE,
      uuid,
      "comment",
      "hello",
      "",
      "",
      "",
    ];
    let index = 0;
    const written: string[] = [];
    const args = await promptToolArgs(
      BOARD_TOOLS.find((tool) => tool.name === "post")!,
      async () => lines[index++]!,
      (text) => {
        written.push(text);
      },
      { goals: [] },
    );
    expect(args).toEqual({
      thread_id: uuid,
      type: "comment",
      body: "hello",
    });
    expect(written.join("")).toContain("ひとつ戻ります");
    expect(written.join("")).toContain("提案エンティティも状態遷移も作れない");
    expect(written.join("")).toContain("書き込むスレッドの UUID");
    expect(written.join("")).toContain("1. proposal（提案の発言。案エンティティは増えない）");
    expect(written.join("")).toContain("comment（コメント）");
    expect(written.join("")).toContain("本文。議論に残る文章");
  });

  it("returns from the first field to bulk JSON, then can fill the form", async () => {
    const lines = ["", ESCAPE_LINE, "", "typo を直す", ""];
    let index = 0;
    const args = await promptToolArgs(
      BOARD_TOOLS.find((tool) => tool.name === "set_goals")!,
      async () => lines[index++]!,
      () => undefined,
      { goals: [] },
    );
    expect(args).toEqual({ goals: ["typo を直す"] });
  });

  it("pops the last array item when Escape is pressed in a list", async () => {
    const lines = ["", "typo", ESCAPE_LINE, "report", ""];
    let index = 0;
    const args = await promptToolArgs(
      BOARD_TOOLS.find((tool) => tool.name === "set_goals")!,
      async () => lines[index++]!,
      () => undefined,
      { goals: [] },
    );
    expect(args).toEqual({ goals: ["report"] });
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

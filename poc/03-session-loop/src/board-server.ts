#!/usr/bin/env node
/**
 * PoC-3: スタブのボード MCP サーバ（stdio）
 *
 * ツール: get_briefing / set_goals / complete_goal / post / read_thread / end_session
 * 環境変数:
 *   COMITIA_POC_LOG  - JSONL ログパス
 *   COMITIA_POC_RUN  - 現在の run 番号（アダプタが設定）
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendToolLog, readToolLog, type ToolLogEntry } from "./log.js";

const INITIAL_BUDGET = 100;
const TOOL_COST: Record<string, number> = {
  set_goals: 5,
  complete_goal: 5,
  post: 5,
  read_thread: 3,
};

const postTypeSchema = z.enum([
  "proposal",
  "position",
  "objection",
  "approval",
  "report",
  "comment",
]);

interface GoalRecord {
  id: string;
  text: string;
  status: "pending" | "completed";
}

let remainingBudget = INITIAL_BUDGET;
let goals: GoalRecord[] = [];
const logPath = process.env.COMITIA_POC_LOG;
const currentRun = Number.parseInt(process.env.COMITIA_POC_RUN ?? "0", 10) || undefined;

function restoreFromLog(entries: ToolLogEntry[]): void {
  for (const entry of entries) {
    if (entry.isError) {
      continue;
    }
    const result = entry.result;
    if (
      result !== null &&
      typeof result === "object" &&
      typeof (result as { remaining_budget?: unknown }).remaining_budget ===
        "number"
    ) {
      remainingBudget = (result as { remaining_budget: number }).remaining_budget;
    }
  }

  for (const entry of entries) {
    if (entry.tool === "set_goals" && !entry.isError) {
      const result = entry.result;
      if (
        result !== null &&
        typeof result === "object" &&
        Array.isArray((result as { goals?: unknown }).goals)
      ) {
        goals = (result as { goals: GoalRecord[] }).goals.map((goal) => ({
          id: goal.id,
          text: goal.text,
          status: goal.status,
        }));
      }
    }
    if (entry.tool === "complete_goal" && !entry.isError) {
      const result = entry.result;
      if (
        result !== null &&
        typeof result === "object" &&
        typeof (result as { goal_id?: unknown }).goal_id === "string"
      ) {
        const goalId = (result as { goal_id: string }).goal_id;
        const goal = goals.find((item) => item.id === goalId);
        if (goal) {
          goal.status = "completed";
        }
      }
    }
  }
}

if (logPath) {
  restoreFromLog(readToolLog(logPath));
}

function logCall(
  tool: string,
  args: unknown,
  result: unknown,
  isError?: boolean,
): void {
  if (!logPath) {
    return;
  }
  appendToolLog(logPath, tool, args, result, {
    isError,
    run: currentRun,
  });
}

function spend(tool: string): void {
  const cost = TOOL_COST[tool] ?? 0;
  remainingBudget = Math.max(0, remainingBudget - cost);
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function withBudget(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, remaining_budget: remainingBudget };
}

const server = new McpServer({
  name: "comitia-board-stub",
  version: "0.0.1",
});

server.registerTool(
  "get_briefing",
  {
    description: "コンテキストパック（申し送り・ルール・目標ヒント）を取得する",
    inputSchema: {},
  },
  async () => {
    const briefing = withBudget({
      handover: "前セッションからの申し送り（ダミー）",
      rules: "プロジェクトルール（ダミー）",
      goals_hint: "docs/sample.md の typo を 1 件直し、report で報告する",
      goals: goals.map(({ id, text, status }) => ({ id, text, status })),
    });
    logCall("get_briefing", {}, briefing);
    return jsonResult(briefing);
  },
);

server.registerTool(
  "set_goals",
  {
    description: "その日の目標を宣言する（セッションループの継続判定に使われる）",
    inputSchema: {
      goals: z.array(z.string()).min(1).describe("目標テキストの配列"),
    },
  },
  async (args) => {
    spend("set_goals");
    goals = args.goals.map((text, index) => ({
      id: `g${index + 1}`,
      text,
      status: "pending" as const,
    }));
    const result = withBudget({ ok: true, goals });
    logCall("set_goals", args, result);
    return jsonResult(result);
  },
);

server.registerTool(
  "complete_goal",
  {
    description: "宣言済み目標を完了にする",
    inputSchema: {
      goal_id: z.string().describe("set_goals で付与された goal id"),
    },
  },
  async (args) => {
    const goal = goals.find((item) => item.id === args.goal_id);
    if (!goal) {
      const err = toolError(`未知の goal_id: ${args.goal_id}`);
      logCall("complete_goal", args, { message: err.content[0]?.text }, true);
      return err;
    }
    goal.status = "completed";
    spend("complete_goal");
    const result = withBudget({ ok: true, goal_id: args.goal_id, goals });
    logCall("complete_goal", args, result);
    return jsonResult(result);
  },
);

server.registerTool(
  "post",
  {
    description: "ボードに投稿する（型必須。approval/objection は根拠必須）",
    inputSchema: {
      type: postTypeSchema.describe("投稿の型"),
      body: z.string().describe("本文"),
      rationale: z.string().optional().describe("根拠（approval/objection では必須）"),
    },
  },
  async (args) => {
    const { type, body, rationale } = args;

    if ((type === "approval" || type === "objection") && !rationale?.trim()) {
      const err = toolError("根拠必須");
      logCall("post", args, { message: "根拠必須" }, true);
      return err;
    }

    spend("post");
    const result = withBudget({
      ok: true,
      type,
      body,
      ...(rationale !== undefined ? { rationale } : {}),
    });
    logCall("post", args, result);
    return jsonResult(result);
  },
);

server.registerTool(
  "read_thread",
  {
    description: "スレッド内容を読む（PoC スタブ）",
    inputSchema: {
      thread_id: z.string().describe("スレッド ID"),
    },
  },
  async (args) => {
    spend("read_thread");
    const result = withBudget({
      thread_id: args.thread_id,
      synthesis: "（スタブ）争点要約",
      messages: ["msg-1", "msg-2"],
    });
    logCall("read_thread", args, result);
    return jsonResult(result);
  },
);

server.registerTool(
  "end_session",
  {
    description: "セッションを終了する（申し送り必須）",
    inputSchema: {
      handover: z.string().optional().describe("次セッションへの申し送り"),
    },
  },
  async (args) => {
    if (!args.handover?.trim()) {
      const err = toolError("申し送り（handover）が必須です");
      logCall("end_session", args, { message: "申し送り必須" }, true);
      return err;
    }

    remainingBudget = 0;
    const result = withBudget({
      ok: true,
      handover: args.handover,
    });
    logCall("end_session", args, result);
    return jsonResult(result);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("board-server エラー:", error);
  process.exit(1);
});

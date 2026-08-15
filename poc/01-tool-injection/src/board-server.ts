#!/usr/bin/env node
/**
 * Comitia PoC-1: スタブのボード MCP サーバ（stdio）
 *
 * 環境変数 COMITIA_POC_LOG に JSONL ログファイルパスを指定すると、
 * 全ツールコールを追記する。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendToolLog } from "./log.js";

const INITIAL_BUDGET = 100;
const POST_COST = 5;

const postTypeSchema = z.enum([
  "proposal",
  "position",
  "objection",
  "approval",
  "report",
  "comment",
]);

let remainingBudget = INITIAL_BUDGET;
const logPath = process.env.COMITIA_POC_LOG;

function logCall(
  tool: string,
  args: unknown,
  result: unknown,
  isError?: boolean,
): void {
  if (!logPath) {
    return;
  }
  appendToolLog(logPath, tool, args, result, isError);
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
    const briefing = {
      handover: "前セッションからの申し送り（ダミー）",
      rules: "プロジェクトルール（ダミー）",
      goals_hint: "docs の typo を 1 件直す想定",
      remaining_budget: remainingBudget,
    };
    logCall("get_briefing", {}, briefing);
    return jsonResult(briefing);
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

    remainingBudget = Math.max(0, remainingBudget - POST_COST);
    const result = {
      ok: true,
      type,
      body,
      ...(rationale !== undefined ? { rationale } : {}),
      remaining_budget: remainingBudget,
    };
    logCall("post", args, result);
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
    const result = {
      ok: true,
      handover: args.handover,
      remaining_budget: remainingBudget,
    };
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

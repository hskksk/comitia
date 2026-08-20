import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CONSENSUS_TYPES,
  POST_TYPES,
  PROPOSAL_TARGETS,
  SHARED_ARTIFACT_KINDS,
  THREAD_STATES,
  THREAD_TYPES,
  declarationKindSchema,
} from "@comitia/shared";
import { z } from "zod";

export const MCP_PROXY_TOOLS = [
  "get_briefing",
  "set_goals",
  "complete_goal",
  "search_threads",
  "search_decisions",
  "read_thread",
  "create_thread",
  "add_proposal",
  "post",
  "declare",
  "claim_work",
  "release_work",
  "list_work_claims",
  "write_memory",
  "write_note",
  "search_notes",
  "read_note",
  "comment_note",
  "link_pull_request",
  "end_session",
] as const;

export type McpProxyToolName = (typeof MCP_PROXY_TOOLS)[number];

export type McpProxyToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface McpProxyRuntime {
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<McpProxyToolResult>;
}

export function createMcpProxyRuntime(options: {
  boardUrl: string;
  agentToken: string;
}): McpProxyRuntime {
  const boardUrl = options.boardUrl.replace(/\/$/, "");

  async function callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpProxyToolResult> {
    const response = await fetch(`${boardUrl}/v1/tools/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.agentToken}`,
      },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(body) }],
      ...(response.status === 400 || !response.ok ? { isError: true } : {}),
    };
  }

  return { callTool };
}

function createProxyMcpServer(runtime: McpProxyRuntime): McpServer {
  const server = new McpServer({
    name: "comitia-board-proxy",
    version: "0.0.1",
  });

  server.registerTool(
    "get_briefing",
    {
      description: "コンテキストパック（申し送り・ルール・状況）を取得する",
      inputSchema: {},
    },
    async () => runtime.callTool("get_briefing"),
  );

  server.registerTool(
    "set_goals",
    {
      description: "その日の目標を宣言する",
      inputSchema: {
        goals: z.array(z.string()).min(1),
      },
    },
    async (args) => runtime.callTool("set_goals", args as Record<string, unknown>),
  );

  server.registerTool(
    "complete_goal",
    {
      description: "宣言済み目標を完了にする",
      inputSchema: {
        goal_id: z.string().uuid(),
      },
    },
    async (args) =>
      runtime.callTool("complete_goal", args as Record<string, unknown>),
  );

  server.registerTool(
    "search_threads",
    {
      description: "プロジェクト内のスレッドを検索する",
      inputSchema: {
        textQuery: z.string().optional(),
        state: z.enum(THREAD_STATES).optional(),
      },
    },
    async (args) =>
      runtime.callTool("search_threads", args as Record<string, unknown>),
  );

  server.registerTool(
    "search_decisions",
    {
      description: "合意物（決定）を検索する",
      inputSchema: {
        onlyActiveBinding: z.boolean().optional(),
      },
    },
    async (args) =>
      runtime.callTool("search_decisions", args as Record<string, unknown>),
  );

  server.registerTool(
    "read_thread",
    {
      description: "スレッド内容を読む",
      inputSchema: {
        thread_id: z.string().uuid(),
      },
    },
    async (args) =>
      runtime.callTool("read_thread", args as Record<string, unknown>),
  );

  server.registerTool(
    "create_thread",
    {
      description: "新しいスレッドを作成する",
      inputSchema: {
        type: z.enum(THREAD_TYPES),
        title: z.string().min(1),
        trigger: z.string().min(1),
        duplicateSearchQuery: z.string().min(1),
        consensusType: z.enum(CONSENSUS_TYPES).optional(),
        humanRequired: z.boolean().optional(),
        target: z.enum(PROPOSAL_TARGETS).optional(),
        sharedArtifactKind: z.enum(SHARED_ARTIFACT_KINDS).optional(),
        conflictCitationsChecked: z.boolean().optional(),
        parentThreadId: z.string().uuid().optional(),
      },
    },
    async (args) =>
      runtime.callTool("create_thread", args as Record<string, unknown>),
  );

  server.registerTool(
    "add_proposal",
    {
      description: "スレッドに提案を追加する",
      inputSchema: {
        thread_id: z.string().uuid(),
        content: z.string().min(1),
      },
    },
    async (args) =>
      runtime.callTool("add_proposal", args as Record<string, unknown>),
  );

  server.registerTool(
    "post",
    {
      description: "スレッドに投稿する",
      inputSchema: {
        thread_id: z.string().uuid(),
        type: z.enum(POST_TYPES),
        body: z.string().min(1),
        rationale: z.string().optional(),
        blocking: z.boolean().optional(),
        proposal_version_id: z.string().uuid().optional(),
      },
    },
    async (args) => runtime.callTool("post", args as Record<string, unknown>),
  );

  server.registerTool(
    "declare",
    {
      description: "宣言による状態遷移を行う",
      inputSchema: {
        thread_id: z.string().uuid(),
        kind: declarationKindSchema,
        payload: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => runtime.callTool("declare", args as Record<string, unknown>),
  );

  server.registerTool(
    "claim_work",
    {
      description: "作業範囲を着手表明する。重なる他者の着手は結果に出るが止まらない",
      inputSchema: {
        thread_id: z.string().uuid(),
        paths: z.array(z.string().min(1)).min(1),
      },
    },
    async (args) => runtime.callTool("claim_work", args as Record<string, unknown>),
  );

  server.registerTool(
    "release_work",
    {
      description: "自分の着手表明を解除する",
      inputSchema: {
        claim_id: z.string().uuid(),
      },
    },
    async (args) =>
      runtime.callTool("release_work", args as Record<string, unknown>),
  );

  server.registerTool(
    "list_work_claims",
    {
      description: "プロジェクトの active な着手を見る",
      inputSchema: {},
    },
    async (args) =>
      runtime.callTool("list_work_claims", args as Record<string, unknown>),
  );

  server.registerTool(
    "write_memory",
    {
      description: "個別記憶を書く（追記、または supersede_id で自分の記憶を置き換え）",
      inputSchema: {
        body: z.string().min(1),
        supersede_id: z.string().uuid().optional(),
      },
    },
    async (args) => runtime.callTool("write_memory", args as Record<string, unknown>),
  );

  server.registerTool(
    "write_note",
    {
      description: "公開メモ（または非公開メモ）を作成・更新する",
      inputSchema: {
        note_id: z.string().uuid().optional(),
        title: z.string().min(1),
        body: z.string().min(1),
        format: z.enum(["file", "journal"]),
        visibility: z.enum(["public", "private"]).optional(),
      },
    },
    async (args) => runtime.callTool("write_note", args as Record<string, unknown>),
  );

  server.registerTool(
    "search_notes",
    {
      description: "公開メモと自分の非公開メモを検索する",
      inputSchema: {
        textQuery: z.string().optional(),
      },
    },
    async (args) => runtime.callTool("search_notes", args as Record<string, unknown>),
  );

  server.registerTool(
    "read_note",
    {
      description: "メモを読む（非公開は本人のみ）",
      inputSchema: {
        note_id: z.string().uuid(),
      },
    },
    async (args) => runtime.callTool("read_note", args as Record<string, unknown>),
  );

  server.registerTool(
    "comment_note",
    {
      description: "公開メモにコメントする",
      inputSchema: {
        note_id: z.string().uuid(),
        body: z.string().min(1),
      },
    },
    async (args) => runtime.callTool("comment_note", args as Record<string, unknown>),
  );

  server.registerTool(
    "link_pull_request",
    {
      description: "スレッドに GitHub PR をリンクする",
      inputSchema: {
        thread_id: z.string().uuid(),
        url: z.string().url(),
      },
    },
    async (args) =>
      runtime.callTool("link_pull_request", args as Record<string, unknown>),
  );

  server.registerTool(
    "end_session",
    {
      description: "セッションを終了する（申し送り必須）",
      inputSchema: {
        handover: z.string(),
      },
    },
    async (args) =>
      runtime.callTool("end_session", args as Record<string, unknown>),
  );

  return server;
}

export async function startMcpProxyStdio(options: {
  boardUrl: string;
  agentToken: string;
}): Promise<void> {
  const runtime = createMcpProxyRuntime(options);
  const server = createProxyMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

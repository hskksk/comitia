import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { LoopPhase } from "./continue-judgment.js";
import { BOARD_SERVER_PATH, TSX_CLI_PATH } from "./paths.js";
import type { EngineRunner } from "./session-loop.js";

type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

function parseToolJson(result: ToolCallResult): Record<string, unknown> | null {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function withMcpClient(
  logPath: string,
  runIndex: number,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX_CLI_PATH, BOARD_SERVER_PATH],
    env: {
      ...process.env,
      COMITIA_POC_LOG: logPath,
      COMITIA_POC_RUN: String(runIndex),
    } as Record<string, string>,
    stderr: "pipe",
  });

  const client = new Client({ name: "comitia-fake-adapter", version: "0.0.1" });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

/** 目標完走シナリオ用の偽エンジン */
export function createContinuationFakeRunner(logPath: string): EngineRunner {
  return async ({ runIndex, phase }) => {
    await withMcpClient(logPath, runIndex, async (client) => {
      if (phase === "wind-down") {
        await client.callTool({
          name: "end_session",
          arguments: {
            handover: "PoC-3 偽エンジン: 目標完走シナリオ完了",
          },
        });
        return;
      }

      if (runIndex === 1) {
        await client.callTool({ name: "get_briefing", arguments: {} });
        await client.callTool({
          name: "set_goals",
          arguments: {
            goals: [
              "docs/sample.md の typo を 1 件修正する",
              "report で修正内容を投稿する",
            ],
          },
        });
        await client.callTool({
          name: "post",
          arguments: {
            type: "comment",
            body: "typo 修正に着手",
          },
        });
        await client.callTool({
          name: "complete_goal",
          arguments: { goal_id: "g1" },
        });
        return;
      }

      if (runIndex === 2) {
        await client.callTool({
          name: "post",
          arguments: {
            type: "report",
            body: "sample.md の teh → the を修正した",
          },
        });
        await client.callTool({
          name: "complete_goal",
          arguments: { goal_id: "g2" },
        });
      }
    });

    return {
      exitCode: 0,
      stdout: `fake continuation run ${runIndex}`,
      stderr: "",
    };
  };
}

/** 空転検知シナリオ用の偽エンジン */
export function createIdleFakeRunner(logPath: string): EngineRunner {
  return async ({ runIndex, phase }) => {
    if (phase === "wind-down") {
      await withMcpClient(logPath, runIndex, async (client) => {
        await client.callTool({
          name: "end_session",
          arguments: {
            handover: "PoC-3 偽エンジン: 空転検知で終了",
          },
        });
      });
      return { exitCode: 0, stdout: `fake idle wind-down ${runIndex}`, stderr: "" };
    }

    if (runIndex === 1) {
      await withMcpClient(logPath, runIndex, async (client) => {
        await client.callTool({ name: "get_briefing", arguments: {} });
        await client.callTool({
          name: "set_goals",
          arguments: { goals: ["docs/sample.md の typo を 1 件修正する"] },
        });
        await client.callTool({
          name: "post",
          arguments: { type: "comment", body: "着手" },
        });
      });
    }

    // run 2, 3: 意図的にツール呼び出しなし（空転）
    return {
      exitCode: 0,
      stdout: `fake idle run ${runIndex} (no tools)`,
      stderr: "",
    };
  };
}

export async function callToolJson(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const result = (await client.callTool({ name, arguments: args })) as ToolCallResult;
  return parseToolJson(result);
}

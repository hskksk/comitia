#!/usr/bin/env node
/**
 * 偽エンジン自己検証: MCP Client で board-server に直接接続し、
 * ツール往復と門の検証（根拠必須・申し送り必須）を行う。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readToolLog } from "./log.js";
import { BOARD_SERVER_PATH } from "./paths.js";
import { printResultsTable, type StepResult } from "./results.js";

type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

/** ツール応答のテキスト本文から JSON をパースする */
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

async function main(): Promise<void> {
  const results: StepResult[] = [];
  const tmpDir = mkdtempSync(path.join(tmpdir(), "comitia-poc-fake-"));
  const logPath = path.join(tmpDir, "tool-log.jsonl");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", BOARD_SERVER_PATH],
    env: {
      ...process.env,
      COMITIA_POC_LOG: logPath,
    } as Record<string, string>,
    stderr: "pipe",
  });

  const client = new Client({ name: "comitia-fake-engine", version: "0.0.1" });

  try {
    await client.connect(transport);

    // 1. ツール一覧
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name).sort();
    const expectedTools = ["end_session", "get_briefing", "post"];
    const toolsOk =
      toolNames.length === 3 &&
      expectedTools.every((name) => toolNames.includes(name));
    results.push({
      name: "1. ツール一覧（3 件）",
      pass: toolsOk,
      detail: toolsOk ? toolNames.join(", ") : `取得: ${toolNames.join(", ")}`,
    });

    // 2. get_briefing
    const briefingResult = (await client.callTool({
      name: "get_briefing",
      arguments: {},
    })) as ToolCallResult;
    const briefing = parseToolJson(briefingResult);
    const briefingOk =
      !briefingResult.isError &&
      briefing !== null &&
      typeof briefing.handover === "string" &&
      typeof briefing.rules === "string" &&
      typeof briefing.goals_hint === "string" &&
      briefing.remaining_budget === 100;
    results.push({
      name: "2. get_briefing",
      pass: briefingOk,
      detail: briefingOk
        ? `remaining_budget=${briefing!.remaining_budget}`
        : JSON.stringify(briefingResult).slice(0, 80),
    });

    // 3. post(position) 成功
    const positionResult = (await client.callTool({
      name: "post",
      arguments: { type: "position", body: "PoC 検証用の position 投稿" },
    })) as ToolCallResult;
    const positionJson = parseToolJson(positionResult);
    const positionOk =
      !positionResult.isError &&
      positionJson !== null &&
      positionJson.ok === true &&
      typeof positionJson.remaining_budget === "number";
    results.push({
      name: "3. post(position) 成功",
      pass: positionOk,
      detail: positionOk
        ? `remaining_budget=${positionJson!.remaining_budget}`
        : JSON.stringify(positionResult).slice(0, 80),
    });

    // 4. post(objection) 根拠なし → エラー
    const objectionNoRatResult = (await client.callTool({
      name: "post",
      arguments: { type: "objection", body: "根拠なしの異議" },
    })) as ToolCallResult;
    const objectionNoRatOk =
      objectionNoRatResult.isError === true &&
      (objectionNoRatResult.content ?? []).some(
        (c) => c.type === "text" && c.text?.includes("根拠必須"),
      );
    results.push({
      name: "4. post(objection) 根拠なし→エラー",
      pass: objectionNoRatOk,
      detail: objectionNoRatOk
        ? "isError=true, 根拠必須"
        : JSON.stringify(objectionNoRatResult).slice(0, 80),
    });

    // 5. post(objection) 根拠あり → 成功
    const objectionResult = (await client.callTool({
      name: "post",
      arguments: {
        type: "objection",
        body: "根拠ありの異議",
        rationale: "設計上の懸念があるため",
      },
    })) as ToolCallResult;
    const objectionJson = parseToolJson(objectionResult);
    const objectionOk =
      !objectionResult.isError &&
      objectionJson !== null &&
      objectionJson.ok === true;
    results.push({
      name: "5. post(objection) 根拠あり→成功",
      pass: objectionOk,
      detail: objectionOk
        ? `remaining_budget=${objectionJson!.remaining_budget}`
        : JSON.stringify(objectionResult).slice(0, 80),
    });

    // 6. end_session: handover なし→エラー、あり→成功
    const endNoHandover = (await client.callTool({
      name: "end_session",
      arguments: {},
    })) as ToolCallResult;
    const endNoHandoverOk =
      endNoHandover.isError === true &&
      (endNoHandover.content ?? []).some(
        (c) => c.type === "text" && c.text?.includes("申し送り"),
      );

    const endWithHandover = (await client.callTool({
      name: "end_session",
      arguments: { handover: "PoC 自己検証完了。次は実エンジンで試す。" },
    })) as ToolCallResult;
    const endJson = parseToolJson(endWithHandover);
    const endSessionOk =
      endNoHandoverOk &&
      !endWithHandover.isError &&
      endJson !== null &&
      endJson.remaining_budget === 0;
    results.push({
      name: "6. end_session（門の検証）",
      pass: endSessionOk,
      detail: endSessionOk
        ? "handover なし→エラー、あり→remaining_budget=0"
        : `no-handover isError=${endNoHandover.isError}, with-handover=${JSON.stringify(endWithHandover).slice(0, 60)}`,
    });

    await client.close();
  } catch (error) {
    results.push({
      name: "接続・実行",
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // 7. JSONL ログ検証
  const logEntries = readToolLog(logPath);
  const expectedLogTools = [
    "get_briefing",
    "post",
    "post",
    "post",
    "end_session",
    "end_session",
  ];
  const logTools = logEntries.map((e) => e.tool);
  const logOk =
    logEntries.length === expectedLogTools.length &&
    expectedLogTools.every((tool, i) => logTools[i] === tool);
  results.push({
    name: "7. JSONL ログ記録",
    pass: logOk,
    detail: logOk
      ? `${logEntries.length} 件記録`
      : `期待 ${expectedLogTools.length} 件、実際 ${logEntries.length} 件: ${logTools.join(" → ")}`,
  });

  rmSync(tmpDir, { recursive: true, force: true });

  printResultsTable("偽エンジン自己検証", results);

  const allPass = results.every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("run-fake-engine エラー:", error);
  process.exit(1);
});

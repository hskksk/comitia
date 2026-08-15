#!/usr/bin/env node
/**
 * OpenCode 実エンジン起動ランチャー
 *
 * OPENCODE_CONFIG_CONTENT で MCP 定義を注入してヘッドレス起動する。
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BOARD_SERVER_PATH, TSX_CLI_PATH } from "./paths.js";
import { ENGINE_PROMPT } from "./prompt.js";
import {
  commandExists,
  runHarness,
  runProcess,
  skipAndExit,
} from "./harness.js";

async function main(): Promise<void> {
  if (!commandExists("opencode")) {
    skipAndExit("opencode CLI が PATH にありません");
  }

  const versionCheck = await runProcess("opencode", ["--version"], {
    cwd: process.cwd(),
    timeoutMs: 15_000,
  });
  if (versionCheck.exitCode !== 0) {
    skipAndExit(
      `opencode CLI の起動に失敗しました（プロバイダ未設定の可能性）: ${versionCheck.stderr.slice(0, 200)}`,
    );
  }

  const logDir = mkdtempSync(path.join(tmpdir(), "comitia-poc-opencode-log-"));
  const logPath = path.join(logDir, "tool-log.jsonl");

  /** Anthropic クレジットが無い環境向け。上書き: OPENCODE_POC_MODEL */
  const model =
    process.env.OPENCODE_POC_MODEL ?? "opencode/deepseek-v4-flash-free";

  const mcpConfig = {
    model,
    mcp: {
      "comitia-board": {
        type: "local",
        command: [process.execPath, TSX_CLI_PATH, BOARD_SERVER_PATH],
        enabled: true,
        environment: {
          COMITIA_POC_LOG: logPath,
        },
      },
    },
  };

  const exitCode = await runHarness({
    engineName: "opencode",
    logPath,
    timeoutMs: 300_000,
    run: async ({ workDir }) => {
      const xdgBase = mkdtempSync(path.join(tmpdir(), "comitia-poc-opencode-xdg-"));
      const xdgData = path.join(xdgBase, "data");
      const xdgState = path.join(xdgBase, "state");
      const xdgCache = path.join(xdgBase, "cache");
      mkdirSync(xdgData, { recursive: true });
      mkdirSync(xdgState, { recursive: true });
      mkdirSync(xdgCache, { recursive: true });

      return runProcess(
        "opencode",
        ["run", "-m", model, "--auto", ENGINE_PROMPT],
        {
          cwd: workDir,
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(mcpConfig),
            XDG_CONFIG_HOME: xdgBase,
            XDG_DATA_HOME: xdgData,
            XDG_STATE_HOME: xdgState,
            XDG_CACHE_HOME: xdgCache,
          },
          timeoutMs: 300_000,
        },
      );
    },
  });

  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error("run-opencode エラー:", error);
  process.exit(1);
});

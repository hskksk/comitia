#!/usr/bin/env node
/**
 * Claude Code 実エンジン起動ランチャー
 *
 * 一時 MCP 設定を注入してヘッドレス起動し、ツール往復を検証する。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BOARD_SERVER_PATH, TSX_CLI_PATH } from "./paths.js";
import { ENGINE_PROMPT } from "./prompt.js";
import {
  cliHasFlag,
  commandExists,
  runHarness,
  runProcess,
  skipAndExit,
} from "./harness.js";

async function main(): Promise<void> {
  if (!commandExists("claude")) {
    skipAndExit("claude CLI が PATH にありません");
  }

  // 認証の簡易チェック（バージョン確認）
  const versionCheck = await runProcess("claude", ["--version"], {
    cwd: process.cwd(),
    timeoutMs: 15_000,
  });
  if (versionCheck.exitCode !== 0) {
    skipAndExit(
      `claude CLI の起動に失敗しました（認証未設定の可能性）: ${versionCheck.stderr.slice(0, 200)}`,
    );
  }

  const hasBare = await cliHasFlag("claude", "--bare");
  if (!hasBare) {
    console.warn("警告: claude --help に --bare フラグが見つかりません。スキップします。");
  }

  const configDir = mkdtempSync(path.join(tmpdir(), "comitia-poc-claude-config-"));
  const mcpConfigPath = path.join(configDir, "mcp-config.json");
  const logDir = mkdtempSync(path.join(tmpdir(), "comitia-poc-claude-log-"));
  const logPath = path.join(logDir, "tool-log.jsonl");

  const exitCode = await runHarness({
    engineName: "claude",
    logPath,
    timeoutMs: 300_000,
    run: async ({ workDir }) => {
      writeFileSync(
        mcpConfigPath,
        JSON.stringify(
          {
            mcpServers: {
              "comitia-board": {
                command: process.execPath,
                args: [TSX_CLI_PATH, BOARD_SERVER_PATH],
                env: {
                  COMITIA_POC_LOG: logPath,
                },
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const args = [
        "-p",
        ENGINE_PROMPT,
        "--mcp-config",
        mcpConfigPath,
        "--strict-mcp-config",
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "stream-json",
        "--verbose",
      ];
      if (hasBare) {
        args.push("--bare");
      }

      const isolatedHome = mkdtempSync(
        path.join(tmpdir(), "comitia-poc-claude-home-"),
      );

      return runProcess("claude", args, {
        cwd: workDir,
        env: { HOME: isolatedHome },
        timeoutMs: 300_000,
      });
    },
  });

  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error("run-claude エラー:", error);
  process.exit(1);
});

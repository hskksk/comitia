#!/usr/bin/env node
/**
 * Claude Code 実エンジン: セッションループ検証
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cliHasFlag,
  commandExists,
  copyFixturesToWorkDir,
  runClaudeHarness,
  runProcess,
  skipAndExit,
} from "./harness.js";
import {
  BOARD_SERVER_PATH,
  FIXTURES_DIR,
  TSX_CLI_PATH,
} from "./paths.js";
import { runSessionLoop } from "./session-loop.js";

async function main(): Promise<void> {
  if (!commandExists("claude")) {
    skipAndExit("claude CLI が PATH にありません");
  }

  const versionCheck = await runProcess("claude", ["--version"], {
    cwd: process.cwd(),
    timeoutMs: 15_000,
  });
  if (versionCheck.exitCode !== 0) {
    skipAndExit(
      `claude CLI の起動に失敗しました: ${versionCheck.stderr.slice(0, 200)}`,
    );
  }

  const hasBare = await cliHasFlag("claude", "--bare");
  const configDir = mkdtempSync(path.join(tmpdir(), "comitia-poc3-claude-config-"));
  const mcpConfigPath = path.join(configDir, "mcp-config.json");
  const logDir = mkdtempSync(path.join(tmpdir(), "comitia-poc3-claude-log-"));
  const logPath = path.join(logDir, "tool-log.jsonl");
  const workDir = mkdtempSync(path.join(tmpdir(), "comitia-poc3-claude-work-"));
  copyFixturesToWorkDir(workDir, FIXTURES_DIR);

  const writeMcpConfig = (runIndex: number): void => {
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
                COMITIA_POC_RUN: String(runIndex),
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  };

  const isolatedHome = mkdtempSync(path.join(tmpdir(), "comitia-poc3-claude-home-"));
  const transcripts: string[] = [];

  const exitCode = await runClaudeHarness({
    logPath,
    workDir,
    runSession: async () => {
      const loopResult = await runSessionLoop({
        logPath,
        maxRuns: 5,
        idleRunLimit: 2,
        runEngine: async ({ prompt, runIndex, phase }) => {
          writeMcpConfig(runIndex);
          const args = [
            "-p",
            prompt,
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

          const result = await runProcess("claude", args, {
            cwd: workDir,
            env: {
              HOME: isolatedHome,
            },
            timeoutMs: 300_000,
          });

          transcripts.push(
            [
              `# run ${runIndex} phase=${phase}`,
              `# exitCode: ${result.exitCode}`,
              "",
              "=== stdout ===",
              result.stdout,
              "",
              "=== stderr ===",
              result.stderr,
            ].join("\n"),
          );

          return result;
        },
      });

      return { loopResult, transcripts };
    },
  });

  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error("run-claude エラー:", error);
  process.exit(1);
});

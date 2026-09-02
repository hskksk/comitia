import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { devNull } from "node:os";
import { formatTraceHuman, type TraceEvent } from "@comitia/shared";
import {
  applyClaudeCredentialEnv,
  resolveHostHome,
} from "../claude-auth.js";
import { engineGithubEnv } from "../github-auth.js";
import {
  claudeStreamLineToPartialEvents,
  parseClaudeStreamTrace,
  TraceSessionLog,
} from "../trace-format.js";
import { createBayEnginePlugin } from "./bay-engine.js";
import { resolveMcpStdioEntrypoint } from "./mcp-stdio.js";
import type { EnginePlugin } from "./types.js";

export { resolveMcpStdioEntrypoint };

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

export function buildClaudeArgs(options: {
  prompt: string;
  mcpConfigPath: string;
  appendSystemPrompt?: string;
  model?: string;
}): string[] {
  // Do not pass --bare: it skips OAuth / Keychain credentials, so a host
  // `claude login` would not be inherited. Keep the real HOME (Keychain /
  // ~/.claude credentials) and isolate user settings via --setting-sources
  // plus --strict-mcp-config. Git uses GIT_CONFIG_GLOBAL, not a fake HOME.
  const model = options.model ?? DEFAULT_CLAUDE_MODEL;
  const args = [
    "-p",
    options.prompt,
    "--mcp-config",
    options.mcpConfigPath,
    "--strict-mcp-config",
    "--setting-sources",
    "project,local",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
  ];
  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  }
  return args;
}

export function commandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    timeout: 15_000,
  });
  return !result.error && result.status === 0;
}

export function buildMcpConfig(mcp: {
  command: string;
  args: string[];
  env: Record<string, string>;
}) {
  return {
    mcpServers: {
      "comitia-board": {
        command: mcp.command,
        args: mcp.args,
        env: mcp.env,
        alwaysLoad: true as const,
      },
    },
  };
}

export function buildClaudeRunEnv(
  isolatedHome: string,
  githubToken?: string | null,
  hostEnv: NodeJS.ProcessEnv = process.env,
  hostHome?: string,
): NodeJS.ProcessEnv {
  const resolvedHostHome = hostHome ?? resolveHostHome(hostEnv);
  const env = engineGithubEnv(githubToken ?? null, hostEnv);
  // Claude Code resolves login from $HOME / Keychain. Remapping HOME to a
  // temp dir makes `claude login` invisible even when CLAUDE_CONFIG_DIR is unset.
  env.HOME = resolvedHostHome;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = githubToken
    ? join(isolatedHome, ".gitconfig")
    : devNull;
  env.MCP_CONNECTION_NONBLOCKING = "0";
  return applyClaudeCredentialEnv(env, hostEnv, resolvedHostHome);
}

export function parseClaudeStream(output: string, run: number) {
  const traceLog = new TraceSessionLog(async () => undefined);
  const parsed = parseClaudeStreamTrace(output, run, traceLog);
  const transcript = parsed.events
    .filter((event) => event.kind === "text" && typeof event.text === "string")
    .map((event) => event.text as string)
    .join("\n");
  return {
    transcript,
    toolLog: parsed.toolLog,
    remainingBudget: parsed.remainingBudget,
    tokens: parsed.tokens,
  };
}

/**
 * Append `chunk` to a pending line `buffer`, invoke `onLine` for every
 * complete line found, and return the new (possibly non-empty) remainder.
 * Kept pure/side-effect-free (besides `onLine`) so it is trivial to unit test
 * without spawning a real child process.
 */
export function processClaudeStreamChunk(
  buffer: string,
  chunk: string,
  onLine: (line: string) => void,
): string {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    onLine(line);
  }
  return remainder;
}

/**
 * Turn one line of `claude --output-format stream-json` output into
 * human-readable console line(s), or `null` if nothing worth showing
 * (blank lines, invalid JSON, events with no formatTraceHuman output).
 * Includes assistant thinking/text/tool_use and user tool_result blocks.
 */
export function formatClaudeStreamLineForConsole(line: string): string | null {
  const partials = claudeStreamLineToPartialEvents(line, 0);
  const parts: string[] = [];
  for (const partial of partials) {
    const human = formatTraceHuman({
      v: 1,
      seq: 0,
      at: "",
      ...partial,
    } as TraceEvent);
    if (human) {
      parts.push(human);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n");
}

export function createClaudeCodePlugin(
  options: {
    hostEnv?: NodeJS.ProcessEnv;
    hostHome?: string;
    stdout?: NodeJS.WritableStream;
    model?: string;
  } = {},
): EnginePlugin {
  return createBayEnginePlugin({
    engine: "claude-code",
    hostEnv: options.hostEnv,
    hostHome: options.hostHome,
    stdout: options.stdout,
    model: options.model ?? DEFAULT_CLAUDE_MODEL,
    notStartedMessage: "Claude Code plugin has not been started",
    exitError: (code) => `claude exited with code ${code}`,
  });
}

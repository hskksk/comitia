import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatTraceHuman,
  TRACE_VERSION,
  type TraceEvent,
} from "@comitia/shared";
import { joinSystemPrompt } from "../environment-prompt.js";
import {
  engineGithubEnv,
  writeIsolatedGitHubAuth,
} from "../github-auth.js";
import { extractRemainingBudget } from "../trace-format.js";
import { processClaudeStreamChunk } from "./claude-code.js";
import { resolveMcpStdioEntrypoint } from "./mcp-stdio.js";
import { TOOLSET_OVERVIEW } from "./tool-catalog.js";
import type {
  EngineGithubAuth,
  EnginePlugin,
  EngineRunContext,
} from "./types.js";

const RM_OPTS = {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 100,
} as const;

const CURSOR_CLI_CANDIDATES = ["cursor-agent", "agent"] as const;

export function resolveCursorCliCommand(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const spawnEnv = { ...process.env, ...env };
  for (const command of CURSOR_CLI_CANDIDATES) {
    const result = spawnSync(command, ["--version"], {
      env: spawnEnv,
      stdio: "ignore",
      timeout: 15_000,
    });
    if (!result.error && result.status === 0) {
      return command;
    }
  }
  return null;
}

export function buildCursorArgs(options: {
  prompt: string;
  workDir: string;
  model?: string;
}): string[] {
  const args = [
    "-p",
    options.prompt,
    "--force",
    "--approve-mcps",
    "--trust",
    "--sandbox",
    "disabled",
    "--output-format",
    "stream-json",
    "--workspace",
    options.workDir,
  ];
  if (options.model && options.model.length > 0) {
    args.push("--model", options.model);
  }
  return args;
}

export function buildCursorMcpConfig(mcp: {
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
      },
    },
  };
}

export function normalizeCursorToolName(name: string): string {
  return name
    .replace(/^mcp__/, "")
    .replace(/^comitia-board__/, "")
    .replace(/^mcp_/, "")
    .replace(/^comitia-board_/, "")
    .replace(/^comitia-board-/, "");
}

export function parseCursorToolCallEnvelope(toolCall: unknown): {
  name: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
} | null {
  if (toolCall === null || typeof toolCall !== "object") {
    return null;
  }
  const record = toolCall as Record<string, unknown>;
  if (record.function !== null && typeof record.function === "object") {
    const fn = record.function as Record<string, unknown>;
    const rawName = typeof fn.name === "string" ? fn.name : "function";
    let args: unknown = fn.arguments ?? fn.args;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args) as unknown;
      } catch {
        // Keep the raw string when the vendor payload is not JSON.
      }
    }
    const result = fn.result;
    const isError =
      result !== null &&
      typeof result === "object" &&
      "error" in (result as object);
    return {
      name: normalizeCursorToolName(rawName),
      args,
      result,
      ...(isError ? { isError: true } : {}),
    };
  }
  for (const [key, value] of Object.entries(record)) {
    if (!key.endsWith("ToolCall") || value === null || typeof value !== "object") {
      continue;
    }
    const body = value as Record<string, unknown>;
    const name = key.replace(/ToolCall$/, "");
    let result: unknown = body.result;
    let isError = false;
    if (body.result !== null && typeof body.result === "object") {
      const wrapped = body.result as Record<string, unknown>;
      if ("error" in wrapped) {
        isError = true;
        result = wrapped.error;
      } else if ("success" in wrapped) {
        result = wrapped.success;
      }
    }
    return {
      name: normalizeCursorToolName(name),
      args: body.args,
      result,
      ...(isError ? { isError: true } : {}),
    };
  }
  return null;
}

function assistantTextFromMessage(message: unknown): string {
  if (message === null || typeof message !== "object") {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (
      block !== null &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("");
}

export function cursorStreamLineToPartialEvents(
  line: string,
  run: number,
): Array<Omit<TraceEvent, "v" | "seq" | "at">> {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object") {
    return [];
  }
  const event = parsed as Record<string, unknown>;
  const type = event.type;
  if (type === "assistant") {
    const text = assistantTextFromMessage(event.message);
    if (text.length === 0) {
      return [];
    }
    if ("timestamp_ms" in event && "model_call_id" in event) {
      return [];
    }
    if (!("timestamp_ms" in event) && !("model_call_id" in event) && event.subtype !== "success") {
      // Final flush without timestamp is a duplicate when stream-partial is on.
      // Without --stream-partial-output this is the complete message — keep it.
    }
    return [{ kind: "text", text, run }];
  }
  if (type === "thinking" && typeof event.text === "string" && event.text.length > 0) {
    return [{ kind: "thinking", text: event.text, run }];
  }
  if (type === "tool_call") {
    const parsedCall = parseCursorToolCallEnvelope(event.tool_call);
    if (!parsedCall) {
      return [];
    }
    if (event.subtype === "completed") {
      const remainingBudget = extractRemainingBudget(parsedCall.result);
      return [
        {
          kind: "tool_result",
          tool: parsedCall.name,
          result: parsedCall.result,
          isError: parsedCall.isError,
          remainingBudget: remainingBudget ?? undefined,
          run,
        },
      ];
    }
    return [
      {
        kind: "tool_call",
        tool: parsedCall.name,
        args: parsedCall.args ?? {},
        run,
      },
    ];
  }
  return [];
}

export function formatCursorStreamLineForConsole(line: string): string | null {
  const partials = cursorStreamLineToPartialEvents(line, 0);
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

export function buildCursorRunEnv(options: {
  runtimeDir: string;
  githubToken?: string | null;
  hostEnv?: NodeJS.ProcessEnv;
  mcpEnv?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const hostEnv = options.hostEnv ?? process.env;
  const env = engineGithubEnv(options.githubToken ?? null, hostEnv);
  env.HOME = options.runtimeDir;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = join(options.runtimeDir, ".gitconfig");
  if (options.mcpEnv) {
    Object.assign(env, options.mcpEnv);
  }
  return env;
}

async function writeRuntimeMcpConfig(
  runtimeDir: string,
  mcp: { command: string; args: string[]; env: Record<string, string> },
  mcpEntrypoint: string,
): Promise<void> {
  const cursorDir = join(runtimeDir, ".cursor");
  await mkdir(cursorDir, { recursive: true });
  const config = buildCursorMcpConfig({
    command: mcp.command,
    args: [...mcp.args, mcpEntrypoint],
    env: mcp.env,
  });
  await writeFile(
    join(cursorDir, "mcp.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function createCursorAgentPlugin(
  options: {
    hostEnv?: NodeJS.ProcessEnv;
    stdout?: NodeJS.WritableStream;
    model?: string;
  } = {},
): EnginePlugin {
  const hostEnv = options.hostEnv ?? process.env;
  const consoleOut = options.stdout;
  let workDir: string | undefined;
  let workDirPersistent = false;
  let runtimeDir: string | undefined;
  let instructions = "";
  let mcp:
    | { command: string; args: string[]; env: Record<string, string> }
    | undefined;
  let github: EngineGithubAuth | null = null;
  let runIndex = 0;
  let lastTokens = 0;
  let child: ChildProcess | undefined;

  async function ensureRuntime(): Promise<string> {
    if (runtimeDir) {
      return runtimeDir;
    }
    runtimeDir = await mkdtemp(join(tmpdir(), "comitia-cursor-runtime-"));
    return runtimeDir;
  }

  async function applyGithubAuth(auth: EngineGithubAuth | null) {
    github = auth;
    if (!runtimeDir) {
      return;
    }
    if (auth?.token) {
      await writeIsolatedGitHubAuth(runtimeDir, {
        token: auth.token,
        committerName: auth.committerName,
      });
    }
  }

  async function abortChild() {
    const running = child;
    child = undefined;
    if (!running || running.killed || running.exitCode !== null) {
      return;
    }
    running.kill("SIGTERM");
  }

  return {
    async start(session) {
      await abortChild();
      workDir = session.workDir;
      workDirPersistent = session.workDirPersistent;
      mcp = session.mcp;
      instructions = session.environmentPrompt
        ? joinSystemPrompt(session.environmentPrompt, TOOLSET_OVERVIEW)
        : TOOLSET_OVERVIEW;
      const dir = await ensureRuntime();
      const mcpEntrypoint = resolveMcpStdioEntrypoint();
      await writeRuntimeMcpConfig(dir, session.mcp, mcpEntrypoint);
      await applyGithubAuth(session.github ?? null);
      runIndex = 0;
      lastTokens = 0;
    },

    async updateGithubAuth(auth) {
      await applyGithubAuth(auth);
    },

    async run(prompt, ctx?: EngineRunContext) {
      if (!workDir || !runtimeDir || !mcp) {
        throw new Error("Cursor Agent plugin has not been started");
      }
      const cli = resolveCursorCliCommand(hostEnv);
      if (!cli) {
        throw new Error(
          "Cursor Agent CLI not found (PATH has neither cursor-agent nor agent)",
        );
      }
      if (!hostEnv.CURSOR_API_KEY || hostEnv.CURSOR_API_KEY.length === 0) {
        throw new Error(
          "CURSOR_API_KEY is not set. Cursor Agent uses the official CLI with your own API key.",
        );
      }
      runIndex += 1;
      const fullPrompt = `${instructions}\n\n${prompt}`;
      const args = buildCursorArgs({
        prompt: fullPrompt,
        workDir,
        model: options.model,
      });
      const env = buildCursorRunEnv({
        runtimeDir,
        githubToken: github?.token ?? null,
        hostEnv,
        mcpEnv: mcp.env,
      });
      const toolByCall = new Map<string, { tool: string; args: unknown }>();
      const toolLog: Array<{
        run: number;
        tool: string;
        args: unknown;
        isError?: boolean;
        result?: unknown;
      }> = [];
      const events: TraceEvent[] = [];
      let remainingBudget: number | null = null;
      const traceLive = ctx?.traceLive === true && ctx.trace !== undefined;

      const rememberToolCall = (line: string) => {
        try {
          const parsed = JSON.parse(line.trim()) as {
            type?: unknown;
            subtype?: unknown;
            call_id?: unknown;
            tool_call?: unknown;
          };
          if (parsed.type !== "tool_call" || typeof parsed.call_id !== "string") {
            return;
          }
          const envelope = parseCursorToolCallEnvelope(parsed.tool_call);
          if (!envelope) {
            return;
          }
          if (parsed.subtype === "completed") {
            return;
          }
          toolByCall.set(parsed.call_id, {
            tool: envelope.name,
            args: envelope.args,
          });
        } catch {
          // Non-JSON lines are ignored by the stream parser too.
        }
      };

      const emit = (partial: Omit<TraceEvent, "v" | "seq" | "at">) => {
        if (partial.kind === "tool_result") {
          if (typeof partial.remainingBudget === "number") {
            remainingBudget = partial.remainingBudget;
          }
          let prior: { tool: string; args: unknown } | undefined;
          for (const entry of toolByCall.values()) {
            if (entry.tool === partial.tool) {
              prior = entry;
            }
          }
          toolLog.push({
            run: runIndex,
            tool: partial.tool,
            args: prior?.args,
            ...(partial.isError ? { isError: true } : {}),
            result: partial.result,
          });
        }
        if (ctx?.trace && traceLive) {
          ctx.trace.emit(partial);
        } else if (ctx?.trace) {
          events.push({
            v: TRACE_VERSION,
            seq: events.length,
            at: new Date().toISOString(),
            ...partial,
          } as TraceEvent);
        }
        if (consoleOut) {
          const human = formatTraceHuman({
            v: 1,
            seq: 0,
            at: "",
            ...partial,
          } as TraceEvent);
          if (human) {
            consoleOut.write(`${human}\n`);
          }
        }
      };

      const exitCode = await new Promise<number>((resolve, reject) => {
        const spawned = spawn(cli, args, {
          cwd: workDir,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        child = spawned;
        let buffer = "";
        let stderr = "";
        spawned.stdout?.setEncoding("utf8");
        spawned.stderr?.setEncoding("utf8");
        spawned.stdout?.on("data", (chunk: string) => {
          buffer = processClaudeStreamChunk(buffer, chunk, (line) => {
            rememberToolCall(line);
            for (const partial of cursorStreamLineToPartialEvents(line, runIndex)) {
              emit(partial);
            }
          });
        });
        spawned.stderr?.on("data", (chunk: string) => {
          stderr += chunk;
        });
        spawned.on("error", (error) => {
          child = undefined;
          reject(error);
        });
        spawned.on("close", (code) => {
          child = undefined;
          if (buffer.trim().length > 0) {
            for (const partial of cursorStreamLineToPartialEvents(
              buffer,
              runIndex,
            )) {
              emit(partial);
            }
          }
          if (code !== 0 && stderr.trim().length > 0) {
            reject(
              new Error(
                `cursor-agent exited with code ${code ?? 1}: ${stderr.trim().slice(0, 500)}`,
              ),
            );
            return;
          }
          resolve(code ?? 0);
        });
      });

      if (exitCode !== 0) {
        throw new Error(`cursor-agent exited with code ${exitCode}`);
      }
      return {
        transcript: "",
        toolLog,
        remainingBudget,
        traceEvents: ctx?.trace && !traceLive ? events : undefined,
      };
    },

    async report() {
      return { tokens: lastTokens };
    },

    async stop() {
      await abortChild();
      if (workDir && !workDirPersistent) {
        await rm(workDir, RM_OPTS);
      }
      workDir = undefined;
      workDirPersistent = false;
    },

    async dispose() {
      await abortChild();
      if (runtimeDir) {
        await rm(runtimeDir, RM_OPTS);
      }
      runtimeDir = undefined;
      if (workDir && !workDirPersistent) {
        await rm(workDir, RM_OPTS);
      }
      workDir = undefined;
      workDirPersistent = false;
    },
  };
}

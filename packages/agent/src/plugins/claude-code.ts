import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatTraceHuman, type TraceEvent } from "@comitia/shared";
import { TOOLSET_OVERVIEW } from "./tool-catalog.js";
import {
  applyClaudeCredentialEnv,
  resolveHostHome,
} from "../claude-auth.js";
import { joinSystemPrompt } from "../environment-prompt.js";
import type { EngineGithubAuth, EnginePlugin, EngineRunContext } from "./types.js";
import { engineGithubEnv, writeIsolatedGitHubAuth } from "../github-auth.js";
import {
  claudeStreamLineToPartialEvents,
  parseClaudeStreamTrace,
  TraceSessionLog,
} from "../trace-format.js";

const RM_OPTS = {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 100,
} as const;

async function waitForChildExit(
  process: ChildProcess | undefined,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (!process) {
    return;
  }
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    process.once("close", () => resolve());
    process.once("error", () => resolve());
    process.kill(signal);
  });
}

export function buildClaudeArgs(options: {
  prompt: string;
  mcpConfigPath: string;
  appendSystemPrompt?: string;
}): string[] {
  // Do not pass --bare: it skips OAuth / Keychain credentials, so a host
  // `claude login` would not be inherited. Keep the real HOME (Keychain /
  // ~/.claude credentials) and isolate user settings via --setting-sources
  // plus --strict-mcp-config. Git uses GIT_CONFIG_GLOBAL, not a fake HOME.
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
    "claude-sonnet-5",
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

export function resolveMcpStdioEntrypoint(fromUrl = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    const pkgFile = join(dir, "package.json");
    if (existsSync(pkgFile)) {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
        name?: string;
        bin?: Record<string, string>;
      };
      if (pkg.name === "@comitia/agent") {
        const bin = pkg.bin?.["comitia-mcp-proxy"];
        if (typeof bin !== "string") {
          throw new Error(
            "@comitia/agent package.json is missing bin.comitia-mcp-proxy",
          );
        }
        return join(dir, bin);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate @comitia/agent package.json");
    }
    dir = parent;
  }
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
  } = {},
): EnginePlugin {
  const consoleOut = options.stdout;
  let workDir: string | undefined;
  let workDirPersistent = false;
  let isolatedHome: string | undefined;
  let runtimeDir: string | undefined;
  let mcpConfigPath: string | undefined;
  let child: ChildProcess | undefined;
  let runIndex = 0;
  let lastTokens = 0;
  let environmentPrompt = "";
  let githubToken: string | null = null;

  async function applyGithubAuth(auth: EngineGithubAuth | null) {
    githubToken = auth?.token ?? null;
    if (isolatedHome && auth) {
      await writeIsolatedGitHubAuth(isolatedHome, {
        token: auth.token,
        committerName: auth.committerName,
      });
    }
  }

  return {
    async start(session) {
      workDir = session.workDir;
      workDirPersistent = session.workDirPersistent;
      environmentPrompt = session.environmentPrompt ?? "";
      if (!isolatedHome) {
        isolatedHome = await mkdtemp(join(tmpdir(), "comitia-claude-home-"));
      }
      if (!runtimeDir) {
        runtimeDir = await mkdtemp(join(tmpdir(), "comitia-claude-runtime-"));
      }
      mcpConfigPath = join(runtimeDir, "mcp-config.json");
      const mcpEntrypoint = resolveMcpStdioEntrypoint();
      if (!existsSync(mcpEntrypoint)) {
        throw new Error(
          `MCP stdio entry not found at ${mcpEntrypoint}. Build @comitia/agent first.`,
        );
      }
      await writeFile(
        mcpConfigPath,
        JSON.stringify(
          buildMcpConfig({
            command: session.mcp.command,
            args: [...session.mcp.args, mcpEntrypoint],
            env: session.mcp.env,
          }),
        ),
        "utf8",
      );
      runIndex = 0;
      lastTokens = 0;
      await applyGithubAuth(session.github ?? null);
    },

    async updateGithubAuth(auth) {
      await applyGithubAuth(auth);
    },

    async run(prompt, ctx?: EngineRunContext) {
      if (!workDir || !isolatedHome || !mcpConfigPath) {
        throw new Error("Claude Code plugin has not been started");
      }
      const gitHome = isolatedHome;
      runIndex += 1;
      const args = buildClaudeArgs({
        prompt,
        mcpConfigPath,
        appendSystemPrompt: environmentPrompt
          ? joinSystemPrompt(environmentPrompt, TOOLSET_OVERVIEW)
          : TOOLSET_OVERVIEW,
      });
      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          const running = spawn("claude", args, {
            cwd: workDir,
            env: buildClaudeRunEnv(
              gitHome,
              githubToken,
              options.hostEnv,
              options.hostHome,
            ),
            stdio: ["ignore", "pipe", "pipe"],
          });
          child = running;
          let stdout = "";
          let stderr = "";
          let liveBuffer = "";
          const traceLive = ctx?.traceLive === true && ctx.trace !== undefined;
          running.stdout.setEncoding("utf8");
          running.stderr.setEncoding("utf8");
          running.stdout.on("data", (chunk: string) => {
            stdout += chunk;
            liveBuffer = processClaudeStreamChunk(liveBuffer, chunk, (line) => {
              if (traceLive) {
                for (const partial of claudeStreamLineToPartialEvents(
                  line,
                  runIndex,
                )) {
                  ctx.trace!.emit(partial);
                }
              }
              if (!consoleOut) return;
              const formatted = formatClaudeStreamLineForConsole(line);
              if (formatted) consoleOut.write(`${formatted}\n`);
            });
          });
          running.stderr.on("data", (chunk: string) => { stderr += chunk; });
          running.once("error", (error) => {
            child = undefined;
            reject(error);
          });
          running.once("close", (code) => {
            child = undefined;
            if (code !== 0) {
              reject(
                new Error(
                  `claude exited with code ${code}: ${(stderr || stdout).trim()}`,
                ),
              );
              return;
            }
            resolve({ stdout, stderr });
          });
        },
      );
      const parsed = ctx?.trace
        ? parseClaudeStreamTrace(result.stdout, runIndex, ctx.trace, {
            recordEvents: !ctx.traceLive,
          })
        : (() => {
            const fallback = parseClaudeStream(result.stdout, runIndex);
            return {
              ...fallback,
              events: [] as ReturnType<typeof parseClaudeStreamTrace>["events"],
            };
          })();
      lastTokens = parsed.tokens;
      return {
        transcript: "",
        toolLog: parsed.toolLog,
        remainingBudget: parsed.remainingBudget,
        traceEvents: parsed.events,
      };
    },

    async report() {
      return { tokens: lastTokens };
    },

    async stop() {
      await waitForChildExit(child);
      child = undefined;
      if (workDir && !workDirPersistent) {
        await rm(workDir, RM_OPTS);
      }
      workDir = undefined;
      workDirPersistent = false;
    },

    async dispose() {
      await waitForChildExit(child);
      child = undefined;
      await Promise.all([
        isolatedHome ? rm(isolatedHome, RM_OPTS) : undefined,
        runtimeDir ? rm(runtimeDir, RM_OPTS) : undefined,
        workDir && !workDirPersistent
          ? rm(workDir, RM_OPTS)
          : undefined,
      ]);
      isolatedHome = undefined;
      runtimeDir = undefined;
      workDir = undefined;
      workDirPersistent = false;
      mcpConfigPath = undefined;
      githubToken = null;
    },
  };
}

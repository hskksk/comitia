import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLSET_OVERVIEW } from "./tool-catalog.js";
import {
  applyClaudeCredentialEnv,
  seedIsolatedClaudeAuth,
  resolveHostHome,
} from "../claude-auth.js";
import { joinSystemPrompt } from "../environment-prompt.js";
import type { EngineGithubAuth, EnginePlugin } from "./types.js";
import { engineGithubEnv, writeIsolatedGitHubAuth } from "../github-auth.js";

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
  // `claude login` would not be inherited. Isolated HOME + --strict-mcp-config
  // still keep host hooks, plugins, and MCP servers out of the session.
  const args = [
    "-p",
    options.prompt,
    "--mcp-config",
    options.mcpConfigPath,
    "--strict-mcp-config",
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
  const env = engineGithubEnv(githubToken ?? null, hostEnv);
  env.HOME = isolatedHome;
  env.MCP_CONNECTION_NONBLOCKING = "0";
  return applyClaudeCredentialEnv(
    env,
    hostEnv,
    hostHome ?? resolveHostHome(hostEnv),
  );
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function extractRemainingBudget(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = parseJson(value);
    return parsed === value ? null : extractRemainingBudget(parsed);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractRemainingBudget(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.remaining_budget === "number") {
    return record.remaining_budget;
  }
  for (const child of Object.values(record)) {
    const found = extractRemainingBudget(child);
    if (found !== null) return found;
  }
  return null;
}

export function parseClaudeStream(output: string, run: number) {
  const transcript: string[] = [];
  const toolLog: Array<{
    run: number;
    tool: string;
    args: unknown;
    isError?: boolean;
    result?: unknown;
  }> = [];
  const toolById = new Map<string, number>();
  let remainingBudget: number | null = null;
  let tokens = 0;

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const event = parseJson(line);
    if (event === null || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    const message = record.message;
    if (message && typeof message === "object") {
      const messageRecord = message as Record<string, unknown>;
      const usage = messageRecord.usage;
      if (usage && typeof usage === "object") {
        const usageRecord = usage as Record<string, unknown>;
        for (const key of ["input_tokens", "output_tokens"]) {
          if (typeof usageRecord[key] === "number") tokens += usageRecord[key];
        }
      }
      const content = messageRecord.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block === null || typeof block !== "object") continue;
          const item = block as Record<string, unknown>;
          if (
            record.type === "assistant" &&
            item.type === "text" &&
            typeof item.text === "string"
          ) {
            transcript.push(item.text);
          } else if (item.type === "tool_use" && typeof item.name === "string") {
            const index = toolLog.push({
              run,
              tool: item.name.replace(/^mcp__[^_]+__/, ""),
              args: item.input ?? {},
            }) - 1;
            if (typeof item.id === "string") toolById.set(item.id, index);
          } else if (item.type === "tool_result") {
            const result = item.content;
            const index = typeof item.tool_use_id === "string"
              ? toolById.get(item.tool_use_id)
              : undefined;
            if (index !== undefined) {
              toolLog[index] = {
                ...toolLog[index]!,
                ...(item.is_error === true ? { isError: true } : {}),
                result,
              };
            }
            remainingBudget = extractRemainingBudget(result) ?? remainingBudget;
          }
        }
      }
    }
  }

  return {
    transcript: transcript.join("\n"),
    toolLog,
    remainingBudget,
    tokens,
  };
}

export function createClaudeCodePlugin(options: {
  hostEnv?: NodeJS.ProcessEnv;
  hostHome?: string;
} = {}): EnginePlugin {
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
        await seedIsolatedClaudeAuth(isolatedHome, {
          env: options.hostEnv,
          hostHome: options.hostHome,
        });
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

    async run(prompt) {
      if (!workDir || !isolatedHome || !mcpConfigPath) {
        throw new Error("Claude Code plugin has not been started");
      }
      const home = isolatedHome;
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
              home,
              githubToken,
              options.hostEnv,
              options.hostHome,
            ),
            stdio: ["ignore", "pipe", "pipe"],
          });
          child = running;
          let stdout = "";
          let stderr = "";
          running.stdout.setEncoding("utf8");
          running.stderr.setEncoding("utf8");
          running.stdout.on("data", (chunk: string) => { stdout += chunk; });
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
      const parsed = parseClaudeStream(result.stdout, runIndex);
      lastTokens = parsed.tokens;
      return {
        transcript: parsed.transcript,
        toolLog: parsed.toolLog,
        remainingBudget: parsed.remainingBudget,
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

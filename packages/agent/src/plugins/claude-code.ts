import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EnginePlugin } from "./types.js";

const RUN_TIMEOUT_MS = 300_000;

export function buildClaudeArgs(options: {
  prompt: string;
  mcpConfigPath: string;
  hasBare: boolean;
}): string[] {
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
  ];
  if (options.hasBare) {
    args.push("--bare");
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

function claudeHasBare(): boolean {
  const result = spawnSync("claude", ["--help"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return result.status === 0 && result.stdout.includes("--bare");
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

export function createClaudeCodePlugin(): EnginePlugin {
  let workDir: string | undefined;
  let isolatedHome: string | undefined;
  let runtimeDir: string | undefined;
  let mcpConfigPath: string | undefined;
  let hasBare = false;
  let child: ChildProcess | undefined;
  let runIndex = 0;
  let lastTokens = 0;

  return {
    async start(session) {
      workDir = session.workDir;
      isolatedHome = await mkdtemp(join(tmpdir(), "comitia-claude-home-"));
      runtimeDir = await mkdtemp(join(tmpdir(), "comitia-claude-runtime-"));
      mcpConfigPath = join(runtimeDir, "mcp-config.json");
      const mcpEntrypoint = fileURLToPath(
        new URL("../mcp-stdio-main.js", import.meta.url),
      );
      await writeFile(
        mcpConfigPath,
        JSON.stringify({
          mcpServers: {
            "comitia-board": {
              command: session.mcp.command,
              args: [...session.mcp.args, mcpEntrypoint],
              env: session.mcp.env,
            },
          },
        }),
        "utf8",
      );
      hasBare = claudeHasBare();
      runIndex = 0;
      lastTokens = 0;
    },

    async run(prompt) {
      if (!workDir || !isolatedHome || !mcpConfigPath) {
        throw new Error("Claude Code plugin has not been started");
      }
      runIndex += 1;
      const args = buildClaudeArgs({ prompt, mcpConfigPath, hasBare });
      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          const running = spawn("claude", args, {
            cwd: workDir,
            env: { ...process.env, HOME: isolatedHome },
            stdio: ["ignore", "pipe", "pipe"],
          });
          child = running;
          let stdout = "";
          let stderr = "";
          running.stdout.setEncoding("utf8");
          running.stderr.setEncoding("utf8");
          running.stdout.on("data", (chunk: string) => { stdout += chunk; });
          running.stderr.on("data", (chunk: string) => { stderr += chunk; });
          const timeout = setTimeout(() => {
            running.kill("SIGTERM");
            reject(new Error("Claude Code run timed out after 5 minutes"));
          }, RUN_TIMEOUT_MS);
          running.once("error", (error) => {
            clearTimeout(timeout);
            child = undefined;
            reject(error);
          });
          running.once("close", (code) => {
            clearTimeout(timeout);
            child = undefined;
            if (code !== 0) {
              reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
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
      child?.kill("SIGTERM");
      child = undefined;
      await Promise.all([
        isolatedHome ? rm(isolatedHome, { recursive: true, force: true }) : undefined,
        runtimeDir ? rm(runtimeDir, { recursive: true, force: true }) : undefined,
        workDir ? rm(workDir, { recursive: true, force: true }) : undefined,
      ]);
      isolatedHome = undefined;
      runtimeDir = undefined;
      workDir = undefined;
      mcpConfigPath = undefined;
    },
  };
}

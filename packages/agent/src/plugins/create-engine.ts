import type { McpProxyToolResult } from "../mcp-proxy.js";
import { assertSupportedEngine } from "../engines.js";
import { createClaudeCodePlugin } from "./claude-code.js";
import { createFakeEnginePlugin } from "./fake.js";
import {
  createInteractiveFakeEnginePlugin,
  type InteractiveIo,
} from "./interactive-fake.js";
import { createCursorAgentPlugin } from "./cursor-agent.js";
import { createOpencodePlugin } from "./opencode.js";
import type { EnginePlugin } from "./types.js";

/** Optional model override. Empty or unset leaves the engine default. */
export const ENGINE_MODEL_ENV = {
  opencode: "COMITIA_OPENCODE_MODEL",
  "cursor-agent": "COMITIA_CURSOR_MODEL",
  "claude-code": "COMITIA_CLAUDE_MODEL",
} as const;

export function resolveEngineModel(
  engine: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!(engine in ENGINE_MODEL_ENV)) {
    return undefined;
  }
  const key = ENGINE_MODEL_ENV[engine as keyof typeof ENGINE_MODEL_ENV];
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return value;
}

export function createEnginePlugin(options: {
  engine: string;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<McpProxyToolResult>;
  scriptedFake?: boolean;
  io?: InteractiveIo;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  onInterrupt?: () => void;
  env?: NodeJS.ProcessEnv;
}): EnginePlugin {
  if (options.scriptedFake) {
    return createFakeEnginePlugin({
      script: [{ tool: "get_briefing", args: {} }],
      callTool: options.callTool,
    });
  }
  assertSupportedEngine(options.engine);
  if (options.engine === "fake") {
    return createInteractiveFakeEnginePlugin({
      callTool: options.callTool,
      io: options.io,
      stdin: options.stdin,
      stdout: options.stdout,
      onInterrupt: options.onInterrupt,
    });
  }
  const env = options.env ?? process.env;
  const model = resolveEngineModel(options.engine, env);
  if (options.engine === "opencode") {
    return createOpencodePlugin({
      stdout: options.stdout,
      model,
    });
  }
  if (options.engine === "cursor-agent") {
    return createCursorAgentPlugin({
      stdout: options.stdout,
      model,
    });
  }
  return createClaudeCodePlugin({ stdout: options.stdout, model });
}

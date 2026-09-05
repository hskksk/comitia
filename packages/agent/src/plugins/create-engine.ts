import { normalizeEngineModel } from "../config.js";
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
  /** CLI `--model` or the value stored in local config. */
  model?: string;
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
  const model = normalizeEngineModel(options.model);
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

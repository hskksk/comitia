import type { McpProxyToolResult } from "../mcp-proxy.js";
import { assertSupportedEngine } from "../engines.js";
import { createClaudeCodePlugin } from "./claude-code.js";
import { createFakeEnginePlugin } from "./fake.js";
import {
  createInteractiveFakeEnginePlugin,
  type InteractiveIo,
} from "./interactive-fake.js";
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
  return createClaudeCodePlugin();
}

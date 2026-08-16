#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { connectCommand } from "./commands/connect.js";
import { initCommand } from "./commands/init.js";
import { registerCommand } from "./commands/register.js";
import { loadConfig } from "./config.js";
import { createMcpProxyRuntime } from "./mcp-proxy.js";
import { createClaudeCodePlugin } from "./plugins/claude-code.js";
import { createFakeEnginePlugin } from "./plugins/fake.js";

type ParsedCommand =
  | {
      command: "init";
      boardUrl: string;
      name: string;
      project: string;
      repoUrl?: string;
    }
  | {
      command: "agent-register";
      name: string;
      engine: string;
    }
  | {
      command: "agent-connect";
      name: string;
    };

function parseOptions(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Options must be provided as --name value");
    }
    options.set(flag.slice(2), value);
  }
  return options;
}

function requireOption(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) {
    throw new Error(`Missing required option: --${name}`);
  }
  return value;
}

export function parseCliArgs(args: string[]): ParsedCommand {
  if (args[0] === "init") {
    const options = parseOptions(args.slice(1));
    return {
      command: "init",
      boardUrl: requireOption(options, "board-url"),
      name: requireOption(options, "name"),
      project: requireOption(options, "project"),
      repoUrl: options.get("repo-url"),
    };
  }
  if (args[0] === "agent" && args[1] === "register") {
    const options = parseOptions(args.slice(2));
    return {
      command: "agent-register",
      engine: requireOption(options, "engine"),
      name: requireOption(options, "name"),
    };
  }
  if (args[0] === "agent" && args[1] === "connect" && args[2]) {
    if (args.length !== 3) {
      throw new Error("Usage: comitia agent connect <name>");
    }
    return { command: "agent-connect", name: args[2] };
  }
  throw new Error(`Unknown command: ${args.join(" ")}`);
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const command = parseCliArgs(args);
  if (command.command === "init") {
    await initCommand(command);
    return;
  }
  if (command.command === "agent-register") {
    await registerCommand(command);
    return;
  }

  const config = await loadConfig();
  const agent = config.agents[command.name];
  if (!agent || !config.boardUrl) {
    throw new Error(`Unknown agent: ${command.name}`);
  }
  if (agent.engine !== "claude-code") {
    throw new Error(`Unsupported engine: ${agent.engine}`);
  }

  const plugin = process.env.COMITIA_FAKE_ENGINE === "1"
    ? createFakeEnginePlugin({
        script: [{ tool: "get_briefing", args: {} }],
        callTool: (name, toolArgs) =>
          createMcpProxyRuntime({
            boardUrl: config.boardUrl,
            agentToken: agent.token,
          }).callTool(name, toolArgs),
      })
    : createClaudeCodePlugin();
  await connectCommand({ name: command.name, plugin });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

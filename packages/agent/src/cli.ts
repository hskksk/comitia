#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { agentLogsCommand } from "./commands/agent-logs.js";
import { agentListCommand } from "./commands/agent-list.js";
import { connectCommand } from "./commands/connect.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { projectCommand, projectSetCommand } from "./commands/project.js";
import { registerCommand } from "./commands/register.js";
import { statusCommand } from "./commands/status.js";
import { tokenCommand } from "./commands/token.js";
import { updateCommand } from "./commands/update.js";
import { wakeCommand } from "./commands/wake.js";
import {
  formatUnknownCommandMessage,
  USAGE_TEXT,
  UsageError,
} from "./cli-usage.js";
import { loadConfig } from "./config.js";
import { assertSupportedEngine } from "./engines.js";
import { createMcpProxyRuntime } from "./mcp-proxy.js";
import { createEnginePlugin } from "./plugins/create-engine.js";

type ParsedCommand =
  | { command: "help" }
  | {
      command: "init";
      boardUrl: string;
      name: string;
      project: string;
      repoUrl?: string;
    }
  | {
      command: "token";
    }
  | {
      command: "status";
    }
  | {
      command: "doctor";
    }
  | {
      command: "agent-list";
    }
  | {
      command: "agent-register";
      name: string;
      engine: string;
      role?: string;
    }
  | {
      command: "agent-connect";
      name: string;
    }
  | {
      command: "agent-wake";
      name: string;
    }
  | {
      command: "agent-logs";
      name: string;
      sessionId?: string;
      follow: boolean;
    }
  | {
      command: "agent-update";
      name: string;
      engine: string;
    }
  | {
      command: "project";
    }
  | {
      command: "project-set";
      repoUrl?: string;
      clearRepo: boolean;
    };

function isHelpArgs(args: string[]): boolean {
  return (
    args.length === 0 ||
    args[0] === "help" ||
    args[0] === "-h" ||
    args[0] === "--help"
  );
}

function parseOptions(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--help" || flag === "-h") {
      throw new UsageError(USAGE_TEXT);
    }
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
  if (isHelpArgs(args)) {
    return { command: "help" };
  }
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
  if (args[0] === "token") {
    if (args.length !== 1) {
      throw new UsageError("Usage: comitia token");
    }
    return { command: "token" };
  }
  if (args[0] === "status") {
    if (args.length !== 1) {
      throw new UsageError("Usage: comitia status");
    }
    return { command: "status" };
  }
  if (args[0] === "doctor") {
    if (args.length !== 1) {
      throw new UsageError("Usage: comitia doctor");
    }
    return { command: "doctor" };
  }
  if (args[0] === "agent" && args[1] === "list") {
    if (args.length !== 2) {
      throw new UsageError("Usage: comitia agent list");
    }
    return { command: "agent-list" };
  }
  if (args[0] === "agent" && args[1] === "register") {
    const options = parseOptions(args.slice(2));
    return {
      command: "agent-register",
      engine: requireOption(options, "engine"),
      name: requireOption(options, "name"),
      role: options.get("role"),
    };
  }
  if (args[0] === "agent" && args[1] === "connect") {
    if (!args[2]) {
      throw new UsageError("Usage: comitia agent connect <name>");
    }
    if (args.length !== 3) {
      throw new UsageError("Usage: comitia agent connect <name>");
    }
    return { command: "agent-connect", name: args[2] };
  }
  if (args[0] === "agent" && args[1] === "wake") {
    if (!args[2]) {
      throw new UsageError("Usage: comitia agent wake <name>");
    }
    if (args.length !== 3) {
      throw new UsageError("Usage: comitia agent wake <name>");
    }
    return { command: "agent-wake", name: args[2] };
  }
  if (args[0] === "agent" && args[1] === "logs") {
    if (!args[2]) {
      throw new UsageError(
        "Usage: comitia agent logs <name> [--session <id>] [--follow]",
      );
    }
    const name = args[2];
    let sessionId: string | undefined;
    let follow = false;
    const rest = args.slice(3);
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--follow") {
        follow = true;
        continue;
      }
      if (token === "--session") {
        const value = rest[index + 1];
        if (!value) {
          throw new UsageError(
            "Usage: comitia agent logs <name> [--session <id>] [--follow]",
          );
        }
        sessionId = value;
        index += 1;
        continue;
      }
      throw new UsageError(
        "Usage: comitia agent logs <name> [--session <id>] [--follow]",
      );
    }
    return { command: "agent-logs", name, sessionId, follow };
  }
  if (args[0] === "agent" && args[1] === "update") {
    if (!args[2]) {
      throw new UsageError("Usage: comitia agent update <name> --engine <engine>");
    }
    const options = parseOptions(args.slice(3));
    return {
      command: "agent-update",
      name: args[2],
      engine: requireOption(options, "engine"),
    };
  }
  if (args[0] === "project" && args[1] === undefined) {
    return { command: "project" };
  }
  if (args[0] === "project" && args[1] === "set") {
    const rest = args.slice(2);
    let repoUrl: string | undefined;
    let clearRepo = false;
    const usage =
      "Usage: comitia project set --repo-url <url> | --clear-repo";
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--clear-repo") {
        clearRepo = true;
        continue;
      }
      if (token === "--repo-url") {
        const value = rest[index + 1];
        if (!value) {
          throw new UsageError(usage);
        }
        repoUrl = value;
        index += 1;
        continue;
      }
      throw new UsageError(usage);
    }
    if (repoUrl === undefined && !clearRepo) {
      throw new UsageError(usage);
    }
    return { command: "project-set", repoUrl, clearRepo };
  }
  throw new UsageError(formatUnknownCommandMessage(args));
}

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface RunCliOptions {
  configDir?: string;
  stdout?: CliOutput;
  stderr?: CliOutput;
  fetch?: typeof globalThis.fetch;
}

export async function runCli(
  args = process.argv.slice(2),
  options: RunCliOptions = {},
): Promise<void> {
  const command = parseCliArgs(args);
  const io = {
    configDir: options.configDir,
    stdout: options.stdout,
    stderr: options.stderr,
    fetch: options.fetch,
  };

  if (command.command === "help") {
    (options.stdout ?? process.stdout).write(`${USAGE_TEXT}\n`);
    return;
  }
  if (command.command === "init") {
    await initCommand({ ...command, configDir: options.configDir });
    return;
  }
  if (command.command === "token") {
    await tokenCommand(io);
    return;
  }
  if (command.command === "status") {
    await statusCommand(io);
    return;
  }
  if (command.command === "doctor") {
    await doctorCommand(io);
    return;
  }
  if (command.command === "agent-list") {
    await agentListCommand(io);
    return;
  }
  if (command.command === "agent-register") {
    await registerCommand({ ...command, configDir: options.configDir });
    return;
  }
  if (command.command === "agent-wake") {
    await wakeCommand({ ...command, ...io });
    return;
  }
  if (command.command === "agent-logs") {
    await agentLogsCommand({ ...command, ...io });
    return;
  }
  if (command.command === "agent-update") {
    await updateCommand({ ...command, configDir: options.configDir, stdout: io.stdout });
    return;
  }
  if (command.command === "project") {
    await projectCommand(io);
    return;
  }
  if (command.command === "project-set") {
    await projectSetCommand({ ...command, ...io });
    return;
  }

  const config = await loadConfig(options.configDir);
  const agent = config.agents[command.name];
  if (!agent || !config.boardUrl) {
    throw new Error(`Unknown agent: ${command.name}`);
  }
  assertSupportedEngine(agent.engine);

  const stdout = options.stdout ?? process.stdout;
  const runtime = createMcpProxyRuntime({
    boardUrl: config.boardUrl,
    agentToken: agent.token,
  });
  let handle: Awaited<ReturnType<typeof connectCommand>> | undefined;
  const plugin = createEnginePlugin({
    engine: agent.engine,
    callTool: (name, toolArgs) => runtime.callTool(name, toolArgs),
    scriptedFake: process.env.COMITIA_FAKE_ENGINE === "1",
    stdout,
    onInterrupt: () => {
      void handle?.close().finally(() => {
        process.exit(0);
      });
    },
  });
  if (agent.engine === "fake" && process.env.COMITIA_FAKE_ENGINE !== "1") {
    stdout.write(
      `${command.name} を fake エンジンで接続します。tick のあと、エージェントと同じプロンプトとツール選択が出ます。Ctrl-C で切断します。\n`,
    );
  } else {
    stdout.write(
      `${command.name} を接続しています。Ctrl-C で切断します。\n`,
    );
  }
  handle = await connectCommand({
    name: command.name,
    plugin,
    configDir: options.configDir,
  });
  if (options.stdout === undefined) {
    process.once("SIGINT", () => {
      void handle?.close().finally(() => {
        process.exit(0);
      });
    });
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runCli().catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

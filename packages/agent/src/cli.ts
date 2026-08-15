#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { initCommand } from "./commands/init.js";
import { registerCommand } from "./commands/register.js";

type ParsedCommand =
  | {
      command: "init";
      boardUrl: string;
      name: string;
      project: string;
    }
  | {
      command: "agent-register";
      name: string;
      engine: string;
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
  throw new Error(`Unknown command: ${args.join(" ")}`);
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const command = parseCliArgs(args);
  if (command.command === "init") {
    await initCommand(command);
    return;
  }
  await registerCommand(command);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

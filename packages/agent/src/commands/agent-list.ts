import { loadConfig } from "../config.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface AgentListCommandOptions {
  configDir?: string;
  stdout?: CliOutput;
}

export async function agentListCommand(
  options: AgentListCommandOptions = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const config = await loadConfig(options.configDir);
  const names = Object.keys(config.agents).sort();
  if (names.length === 0) {
    stdout.write("登録済みエージェントはありません。\n");
    return;
  }
  for (const name of names) {
    const agent = config.agents[name]!;
    const line = agent.model
      ? `${name}\t${agent.engine}\t${agent.agentId}\t${agent.model}`
      : `${name}\t${agent.engine}\t${agent.agentId}`;
    stdout.write(`${line}\n`);
  }
}

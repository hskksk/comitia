import { loadConfig, saveConfig } from "../config.js";
import { assertSupportedEngine } from "../engines.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface UpdateCommandOptions {
  name: string;
  engine: string;
  configDir?: string;
  stdout?: CliOutput;
}

export async function updateCommand(
  options: UpdateCommandOptions,
): Promise<void> {
  assertSupportedEngine(options.engine);

  const stdout = options.stdout ?? process.stdout;
  const config = await loadConfig(options.configDir);
  const agent = config.agents[options.name];
  if (!agent) {
    throw new Error(`不明なエージェント: ${options.name}`);
  }

  await saveConfig(options.configDir, {
    ...config,
    agents: {
      ...config.agents,
      [options.name]: {
        ...agent,
        engine: options.engine,
      },
    },
  });
  stdout.write(`${options.name} の engine を ${options.engine} に更新しました。\n`);
}

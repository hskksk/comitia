import { loadConfig, saveConfig } from "../config.js";
import { assertSupportedEngine } from "../engines.js";
import { formatHttpError } from "../http-error.js";
import { ownerAuthHeaders } from "../owner-headers.js";
import { resolvePersonalitySpec } from "../personality-spec.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface UpdateCommandOptions {
  name: string;
  engine?: string;
  personality?: string;
  configDir?: string;
  stdout?: CliOutput;
  fetch?: typeof globalThis.fetch;
}

export async function updateCommand(
  options: UpdateCommandOptions,
): Promise<void> {
  if (options.engine) {
    assertSupportedEngine(options.engine);
  }

  const stdout = options.stdout ?? process.stdout;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const config = await loadConfig(options.configDir);
  const agent = config.agents[options.name];
  if (!agent) {
    throw new Error(`不明なエージェント: ${options.name}`);
  }

  if (options.personality !== undefined) {
    if (!config.boardUrl) {
      throw new Error("boardUrl が設定されていません。`comitia init` を実行してください。");
    }
    const personality = resolvePersonalitySpec(options.personality);
    const response = await fetchFn(
      new URL(`/v1/me/agents/${agent.agentId}`, config.boardUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...ownerAuthHeaders(config),
        },
        body: JSON.stringify({
          personality,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(await formatHttpError(response));
    }
    stdout.write(
      personality === null
        ? `${options.name} の性格を外しました。\n`
        : `${options.name} の性格を更新しました。\n`,
    );
  }

  if (options.engine) {
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
}

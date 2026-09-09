import { loadConfig } from "../config.js";
import { formatHttpError } from "../http-error.js";
import { ownerAuthHeaders } from "../owner-headers.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface AgentShowCommandOptions {
  name: string;
  configDir?: string;
  stdout?: CliOutput;
  fetch?: typeof globalThis.fetch;
}

type OwnedAgent = {
  id: string;
  displayName: string;
  engine: string;
  personality: string | null;
};

function formatLocalLines(input: {
  name: string;
  agentId: string;
  engine: string;
  model?: string;
}): string[] {
  return [
    `名前: ${input.name}`,
    `agentId: ${input.agentId}`,
    `エンジン（ローカル）: ${input.engine}`,
    `モデル: ${input.model ?? "（既定）"}`,
  ];
}

export async function agentShowCommand(
  options: AgentShowCommandOptions,
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const config = await loadConfig(options.configDir);
  const agent = config.agents[options.name];
  if (!agent) {
    throw new Error(`不明なエージェント: ${options.name}`);
  }

  const localLines = formatLocalLines({
    name: options.name,
    agentId: agent.agentId,
    engine: agent.engine,
    model: agent.model,
  });

  if (!config.boardUrl) {
    stdout.write(
      `${localLines.join("\n")}\nボード: 取得できません（boardUrl が設定されていません。\`comitia init\` を実行してください。）\n`,
    );
    return;
  }

  let owned: OwnedAgent | undefined;
  try {
    const headers = ownerAuthHeaders(config);
    const response = await fetchFn(new URL("/v1/me/agents", config.boardUrl), {
      headers,
    });
    if (!response.ok) {
      throw new Error(await formatHttpError(response));
    }
    const body = (await response.json()) as { items?: OwnedAgent[] };
    owned = (body.items ?? []).find((item) => item.id === agent.agentId);
    if (!owned) {
      stdout.write(
        `${localLines.join("\n")}\nボード: 取得できません（所有エージェントに ${agent.agentId} がありません。）\n`,
      );
      return;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    stdout.write(`${localLines.join("\n")}\nボード: 取得できません（${reason}）\n`);
    return;
  }

  const personality = owned.personality?.trim()
    ? owned.personality
    : "（未設定）";
  const lines = [
    `名前: ${options.name}`,
    `agentId: ${agent.agentId}`,
    `表示名: ${owned.displayName}`,
    `性格: ${personality}`,
    `エンジン（ローカル）: ${agent.engine}`,
    `エンジン（ボード）: ${owned.engine}`,
    `モデル: ${agent.model ?? "（既定）"}`,
  ];
  if (owned.engine !== agent.engine) {
    lines.push(
      `警告: ローカルのエンジン（${agent.engine}）とボード（${owned.engine}）が違います。`,
    );
  }
  stdout.write(`${lines.join("\n")}\n`);
}

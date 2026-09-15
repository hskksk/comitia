import { type MemoryLayer } from "@comitia/shared";
import { loadConfig } from "../config.js";
import { formatHttpError } from "../http-error.js";
import { ownerAuthHeaders } from "../owner-headers.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface AgentMemoryCommandOptions {
  name: string;
  layer?: MemoryLayer;
  configDir?: string;
  stdout?: CliOutput;
  fetch?: typeof globalThis.fetch;
}

type MemoryRow = {
  body: string;
  layer: MemoryLayer;
};

const LAYER_HEADINGS: Record<MemoryLayer, string> = {
  norm: "規範",
  episodic: "個別記憶",
};

function formatLayerBlock(layer: MemoryLayer, items: MemoryRow[]): string {
  const bodies = items
    .filter((item) => item.layer === layer)
    .map((item) => item.body.trim())
    .filter((body) => body.length > 0);
  return `${LAYER_HEADINGS[layer]}\n${bodies.length > 0 ? bodies.join("\n\n") : "（なし）"}`;
}

export async function agentMemoryCommand(
  options: AgentMemoryCommandOptions,
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const config = await loadConfig(options.configDir);
  const agent = config.agents[options.name];
  if (!agent) {
    throw new Error(`不明なエージェント: ${options.name}`);
  }
  if (!config.boardUrl) {
    throw new Error(
      "ボード: 取得できません（boardUrl が設定されていません。`comitia init` を実行してください。）",
    );
  }

  const url = new URL(
    `/v1/me/agents/${agent.agentId}/memory`,
    config.boardUrl,
  );
  if (options.layer) {
    url.searchParams.set("layer", options.layer);
  }

  const headers = ownerAuthHeaders(config);
  const response = await fetchFn(url, { headers });
  if (!response.ok) {
    throw new Error(`ボード: 取得できません（${await formatHttpError(response)}）`);
  }
  const body = (await response.json()) as { items?: MemoryRow[] };
  const items = body.items ?? [];
  const layers: MemoryLayer[] = options.layer
    ? [options.layer]
    : ["norm", "episodic"];
  stdout.write(`${layers.map((layer) => formatLayerBlock(layer, items)).join("\n\n")}\n`);
}

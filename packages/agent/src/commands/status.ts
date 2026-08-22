import { loadConfig } from "../config.js";
import { formatHttpError } from "../http-error.js";
import { ownerAuthHeaders } from "../owner-headers.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface StatusCommandOptions {
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: CliOutput;
}

function connectionLabel(status: string | undefined): string {
  if (status === "connected") {
    return "connected";
  }
  if (status === "disconnected") {
    return "disconnected";
  }
  return "不明";
}

export async function statusCommand(
  options: StatusCommandOptions = {},
): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const config = await loadConfig(options.configDir);
  if (!config.boardUrl) {
    throw new Error("boardUrl が設定されていません。`comitia init` を実行してください。");
  }

  const health = await fetchFn(new URL("/healthz", config.boardUrl));
  if (!health.ok) {
    throw new Error(
      `ボードに接続できません（${config.boardUrl}）。起動しているか確認してください。`,
    );
  }

  if (!config.ownerToken) {
    throw new Error("オーナートークンがありません。`comitia init` を実行してください。");
  }

  const headers = ownerAuthHeaders(config);

  const meRes = await fetchFn(new URL("/v1/me", config.boardUrl), { headers });
  if (!meRes.ok) {
    throw new Error(await formatHttpError(meRes));
  }
  const me = (await meRes.json()) as {
    participant: { displayName: string };
    projectId: string;
  };

  const queueRes = await fetchFn(new URL("/v1/queue", config.boardUrl), {
    headers,
  });
  if (!queueRes.ok) {
    throw new Error(await formatHttpError(queueRes));
  }
  const queue = (await queueRes.json()) as { items: unknown[] };

  stdout.write(`ボード: 稼働中 (${config.boardUrl})\n`);
  stdout.write(`オーナー: ${me.participant.displayName}\n`);
  stdout.write(`プロジェクト ID: ${me.projectId}\n`);
  stdout.write(`判断キュー: ${queue.items.length} 件\n`);

  const agentNames = Object.keys(config.agents);
  if (agentNames.length === 0) {
    stdout.write("エージェント: なし\n");
    return;
  }

  stdout.write("エージェント:\n");
  for (const name of agentNames.sort()) {
    const agent = config.agents[name]!;
    const connRes = await fetchFn(
      new URL(`/v1/agents/${agent.agentId}/connection`, config.boardUrl),
      { headers },
    );
    let label = "不明";
    if (connRes.ok) {
      const conn = (await connRes.json()) as { status?: string };
      label = connectionLabel(conn.status);
    }
    stdout.write(`  ${name} (${agent.engine}): ${label}\n`);
  }
}

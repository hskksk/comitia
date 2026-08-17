import { loadConfig } from "../config.js";
import { formatHttpError } from "../http-error.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface WakeCommandOptions {
  name: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: CliOutput;
}

export async function wakeCommand(options: WakeCommandOptions): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const config = await loadConfig(options.configDir);
  if (!config.boardUrl || !config.ownerToken) {
    throw new Error("設定が不完全です。`comitia init` を実行してください。");
  }

  const agent = config.agents[options.name];
  if (!agent) {
    throw new Error(`不明なエージェント: ${options.name}`);
  }

  const response = await fetchFn(
    new URL(`/v1/agents/${agent.agentId}/request-session`, config.boardUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.ownerToken}`,
      },
      body: "{}",
    },
  );
  if (!response.ok) {
    throw new Error(await formatHttpError(response));
  }

  const result = (await response.json()) as {
    sessionId?: string;
    tickId: string;
    status: "delivered" | "queued";
  };

  if (result.status === "delivered") {
    stdout.write(
      `${options.name}: セッション開始 tick を送信しました（接続中のエージェントへ配信）。\n`,
    );
  } else {
    stdout.write(
      `${options.name}: セッション開始 tick をキューに積みました（エージェント未接続のため待機中）。\n`,
    );
  }
  stdout.write(`  tickId: ${result.tickId}\n`);
  if (result.sessionId) {
    stdout.write(`  sessionId: ${result.sessionId}\n`);
  }
}

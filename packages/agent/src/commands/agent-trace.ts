import { loadConfig } from "../config.js";
import { formatHttpError } from "../http-error.js";
import { ownerAuthHeaders } from "../owner-headers.js";
import { formatTraceHuman, type TraceEvent } from "@comitia/shared";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface AgentTraceCommandOptions {
  name: string;
  sessionId?: string;
  follow?: boolean;
  json?: boolean;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: CliOutput;
  pollMs?: number;
  maxPolls?: number;
}

type SessionList = {
  items: Array<{ id: string; startedAt: string; endedAt: string | null }>;
};

type SessionTraceResponse = {
  sessionId: string;
  entries: TraceEvent[];
  hasMore: boolean;
};

async function readJson<T>(
  fetchFn: typeof fetch,
  url: URL,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetchFn(url, { headers });
  if (!response.ok) {
    throw new Error(await formatHttpError(response));
  }
  return (await response.json()) as T;
}

function formatTraceOutput(
  entries: TraceEvent[],
  json: boolean,
): string {
  if (json) {
    return `${JSON.stringify(entries, null, 2)}\n`;
  }
  const lines: string[] = [];
  for (const entry of entries) {
    const human = formatTraceHuman(entry);
    if (human) {
      lines.push(human);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export async function agentTraceCommand(
  options: AgentTraceCommandOptions,
): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const config = await loadConfig(options.configDir);
  const boardUrl = config.boardUrl;
  const ownerToken = config.ownerToken;
  if (!boardUrl || !ownerToken) {
    throw new Error("設定が不完全です。`comitia init` を実行してください。");
  }
  const agent = config.agents[options.name];
  if (!agent) {
    throw new Error(`不明なエージェント: ${options.name}`);
  }

  const headers = ownerAuthHeaders(config);
  const sessions = await readJson<SessionList>(
    fetchFn,
    new URL(`/v1/agents/${agent.agentId}/sessions`, boardUrl),
    headers,
  );
  const sessionId = options.sessionId ?? sessions.items[0]?.id;
  if (!sessionId) {
    throw new Error(`${options.name}: セッションがありません`);
  }

  const loadTrace = (afterSeq = 0) =>
    readJson<SessionTraceResponse>(
      fetchFn,
      new URL(
        `/v1/sessions/${sessionId}/trace?afterSeq=${afterSeq}&limit=500`,
        boardUrl,
      ),
      headers,
    );

  let afterSeq = 0;
  const first = await loadTrace(afterSeq);
  stdout.write(formatTraceOutput(first.entries, options.json === true));
  afterSeq = first.entries.at(-1)?.seq ?? afterSeq;

  if (!options.follow) {
    return;
  }

  const pollMs = options.pollMs ?? 5_000;
  const maxPolls = options.maxPolls ?? Number.POSITIVE_INFINITY;
  for (let i = 0; i < maxPolls; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const next = await loadTrace(afterSeq);
    if (next.entries.length > 0) {
      stdout.write(formatTraceOutput(next.entries, options.json === true));
      afterSeq = next.entries.at(-1)?.seq ?? afterSeq;
    }
  }
}

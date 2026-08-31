import { loadConfig } from "../config.js";
import {
  formatChatLogDelta,
  formatChatLogForDisplay,
} from "../chat-log-display.js";
import { formatHttpError } from "../http-error.js";
import { ownerAuthHeaders } from "../owner-headers.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface AgentLogsCommandOptions {
  name: string;
  sessionId?: string;
  follow?: boolean;
  /** Emit raw chat_log including @json lines (default: human-readable trace). */
  raw?: boolean;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: CliOutput;
  pollMs?: number;
  maxPolls?: number;
}

type SessionList = {
  items: Array<{ id: string; startedAt: string; endedAt: string | null }>;
};

type ChatLogResponse = {
  chatLog: string;
  truncated: boolean;
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

export async function agentLogsCommand(
  options: AgentLogsCommandOptions,
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

  const loadLog = () =>
    readJson<ChatLogResponse>(
      fetchFn,
      new URL(`/v1/sessions/${sessionId}/chat-log`, boardUrl),
      headers,
    );

  const first = await loadLog();
  const raw = options.raw === true;
  stdout.write(formatChatLogForDisplay(first.chatLog, raw));
  if (!options.follow) {
    return;
  }

  let printedRaw = first.chatLog;
  const pollMs = options.pollMs ?? 5_000;
  const maxPolls = options.maxPolls ?? Number.POSITIVE_INFINITY;
  for (let i = 0; i < maxPolls; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const next = await loadLog();
    if (
      next.chatLog.startsWith(printedRaw) &&
      next.chatLog.length > printedRaw.length
    ) {
      stdout.write(
        formatChatLogDelta(next.chatLog.slice(printedRaw.length), raw),
      );
      printedRaw = next.chatLog;
    } else if (next.chatLog !== printedRaw) {
      stdout.write(formatChatLogForDisplay(next.chatLog, raw));
      printedRaw = next.chatLog;
    }
  }
}

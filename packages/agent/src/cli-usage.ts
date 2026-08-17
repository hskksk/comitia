export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const TOP_LEVEL_COMMANDS = [
  "help",
  "init",
  "token",
  "status",
  "doctor",
  "agent",
] as const;

const AGENT_SUBCOMMANDS = [
  "list",
  "register",
  "connect",
  "wake",
  "update",
] as const;

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0),
  );
  for (let i = 0; i < rows; i += 1) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0]![j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

export function suggestCommand(
  input: string,
  candidates: readonly string[],
): string | undefined {
  const matches = candidates.filter(
    (candidate) =>
      candidate === input ||
      candidate.startsWith(input) ||
      levenshtein(candidate, input) <= 2,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function formatUnknownCommandMessage(args: string[]): string {
  const top = args[0] ?? "";
  const suggestion =
    suggestCommand(top, TOP_LEVEL_COMMANDS) ??
    (top === "agent" && args[1]
      ? suggestCommand(args[1], AGENT_SUBCOMMANDS)
      : undefined);
  const lines = [`不明なコマンド: ${args.join(" ")}`, "", USAGE_TEXT];
  if (suggestion) {
    lines.splice(2, 0, `もしかして: ${top === "agent" ? `agent ${suggestion}` : suggestion}`);
  }
  return lines.join("\n");
}

export const USAGE_TEXT = `Comitia — 日常運転 CLI

使い方:
  comitia <command> [options]

コマンド:
  help              この一覧を表示
  init              プロジェクトを初期化
  token             オーナートークンを表示
  status            ボードとエージェントの状態
  doctor            設定と環境を診断
  agent list        登録済みエージェント一覧
  agent register    エージェントを登録
  agent connect     エージェントを接続
  agent wake        エージェントを起こす
  agent update      エージェント設定を更新

例:
  comitia init --board-url http://127.0.0.1:8787 --name "ハル" --project comitia
  comitia agent register --engine claude-code --name mika
  comitia agent connect mika
  comitia status`;

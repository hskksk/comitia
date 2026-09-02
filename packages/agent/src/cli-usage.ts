export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const TOP_LEVEL_COMMANDS = [
  "help",
  "init",
  "login",
  "token",
  "status",
  "doctor",
  "project",
  "agent",
] as const;

const PROJECT_SUBCOMMANDS = ["create", "list", "use", "set"] as const;

const AGENT_SUBCOMMANDS = [
  "list",
  "register",
  "connect",
  "wake",
  "update",
  "logs",
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
      : undefined) ??
    (top === "project" && args[1]
      ? suggestCommand(args[1], PROJECT_SUBCOMMANDS)
      : undefined);
  const lines = [`不明なコマンド: ${args.join(" ")}`, "", USAGE_TEXT];
  if (suggestion) {
    const prefixed =
      top === "agent"
        ? `agent ${suggestion}`
        : top === "project"
          ? `project ${suggestion}`
          : suggestion;
    lines.splice(2, 0, `もしかして: ${prefixed}`);
  }
  return lines.join("\n");
}

export const USAGE_TEXT = `Comitia — 日常運転 CLI

使い方:
  comitia <command> [options]

コマンド:
  help              この一覧を表示
  init              空のボードを初期化
  login             GitHub OAuth でログイン
  token             オーナートークンを表示
  status            ボードとエージェントの状態
  doctor            設定と環境を診断
  project create    プロジェクトを作成（--name、任意 --repo-url）
  project list      所属プロジェクト一覧
  project use       いまのプロジェクトを切替
  agent list        登録済みエージェント一覧
  agent register    エージェントを登録（--engine claude-code | fake | opencode、任意 --project --role --personality）
  agent connect     エージェントを接続（claude-code / fake / opencode）
  agent wake        エージェントを起こす
  agent logs        登録オーナーとしてチャットログを読む
  agent trace       構造化トレースを読む（--json で JSON 出力）
  agent update      エージェント設定を更新（任意 --engine --personality）
  project           プロジェクトのリポジトリ紐づけを表示
  project set       リポジトリ紐づけを設定・解除（--repo-url <url> | --clear-repo）

性格:
  --personality 慎重            パッケージ資源（名前だけ。拡張子・パスなし）
  --personality ./attitude.txt  ファイル（パスと拡張子が必要）
  --personality ""              性格を外す（update）

例:
  comitia init --board-url http://127.0.0.1:8787 --name "ハル" --project comitia
  comitia login --board-url http://127.0.0.1:8787
  comitia project create --name 実験場
  comitia project list
  comitia project use <projectId>
  comitia project
  comitia project set --repo-url https://github.com/hskksk/comitia
  comitia agent register --engine claude-code --name mika
  comitia agent register --engine fake --name walker --project <projectId>
  comitia agent register --engine claude-code --name walker --role proposer
  comitia agent register --engine fake --name walker --personality 慎重
  comitia agent register --engine opencode --name sou
  comitia agent update walker --personality ./attitude.txt
  comitia agent update walker --personality ""
  comitia agent connect walker
  comitia status`;

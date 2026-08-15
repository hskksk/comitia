import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** JSONL ログの 1 行分 */
export interface ToolLogEntry {
  timestamp: string;
  tool: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  run?: number;
}

/** ツールコールを JSONL ファイルに追記する */
export function appendToolLog(
  logPath: string,
  tool: string,
  args: unknown,
  result: unknown,
  options?: { isError?: boolean; run?: number },
): void {
  const entry: ToolLogEntry = {
    timestamp: new Date().toISOString(),
    tool,
    args,
    result,
    ...(options?.isError !== undefined ? { isError: options.isError } : {}),
    ...(options?.run !== undefined ? { run: options.run } : {}),
  };
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

/** JSONL ファイルを読み込んでエントリ配列を返す */
export function readToolLog(logPath: string): ToolLogEntry[] {
  if (!existsSync(logPath)) {
    return [];
  }
  const content = readFileSync(logPath, "utf8").trim();
  if (!content) {
    return [];
  }
  return content.split("\n").map((line) => JSON.parse(line) as ToolLogEntry);
}

/** ログを run 番号で分割する */
export function sliceLogByRun(
  entries: ToolLogEntry[],
  runIndex: number,
): ToolLogEntry[] {
  return entries.filter((entry) => entry.run === runIndex);
}

/** 最新の remaining_budget をログから取得する */
export function latestRemainingBudget(entries: ToolLogEntry[]): number | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const result = entries[i]?.result;
    if (
      result !== null &&
      typeof result === "object" &&
      "remaining_budget" in result &&
      typeof (result as { remaining_budget: unknown }).remaining_budget ===
        "number"
    ) {
      return (result as { remaining_budget: number }).remaining_budget;
    }
  }
  return null;
}

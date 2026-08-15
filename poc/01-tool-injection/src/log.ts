import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** JSONL ログの 1 行分 */
export interface ToolLogEntry {
  timestamp: string;
  tool: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
}

/** ツールコールを JSONL ファイルに追記する */
export function appendToolLog(
  logPath: string,
  tool: string,
  args: unknown,
  result: unknown,
  isError?: boolean,
): void {
  const entry: ToolLogEntry = {
    timestamp: new Date().toISOString(),
    tool,
    args,
    result,
    ...(isError !== undefined ? { isError } : {}),
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

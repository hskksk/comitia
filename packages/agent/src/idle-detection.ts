/** 1 run 分の空転判定結果 */
export interface IdleRunAnalysis {
  idle: boolean;
  reason?: string;
  toolCount: number;
  repeatedRead?: boolean;
}

export interface ToolLogEntry {
  run: number;
  tool: string;
  args: unknown;
  isError?: boolean;
  result?: unknown;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** run 内のツール呼び出しが空転かどうか */
export function analyzeRunIdle(runEntries: ToolLogEntry[]): IdleRunAnalysis {
  const toolEntries = runEntries.filter((entry) => !entry.isError);
  const toolCount = toolEntries.length;

  if (toolCount === 0) {
    return { idle: true, reason: "ツール呼び出し 0 件", toolCount };
  }

  const readCalls = toolEntries
    .filter((entry) => entry.tool === "read_thread")
    .map((entry) => stableJson(entry.args));

  if (readCalls.length >= 2) {
    const first = readCalls[0];
    const allSame = readCalls.every((call) => call === first);
    if (allSame) {
      return {
        idle: true,
        reason: "read_thread の同一引数繰り返し",
        toolCount,
        repeatedRead: true,
      };
    }
  }

  return { idle: false, toolCount };
}

/** 末尾から連続空転 run 数を数える */
export function countTrailingIdleRuns(
  entries: ToolLogEntry[],
  runCount: number,
): number {
  let trailing = 0;
  for (let run = runCount; run >= 1; run -= 1) {
    const runEntries = entries.filter((entry) => entry.run === run);
    if (analyzeRunIdle(runEntries).idle) {
      trailing += 1;
    } else {
      break;
    }
  }
  return trailing;
}

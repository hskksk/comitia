import { formatTraceHuman, parseTraceLine } from "@comitia/shared";

/** Format one chat_log line for human display; legacy lines pass through. */
export function formatChatLogLine(line: string, raw: boolean): string | null {
  if (raw) {
    return line;
  }
  const event = parseTraceLine(line);
  if (event) {
    return formatTraceHuman(event);
  }
  return line;
}

/** Format a chat_log blob for stdout (default: rich human lines). */
export function formatChatLogForDisplay(chatLog: string, raw: boolean): string {
  if (raw) {
    return chatLog.endsWith("\n") ? chatLog : `${chatLog}\n`;
  }
  const lines: string[] = [];
  for (const line of chatLog.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const event = parseTraceLine(line);
    if (event) {
      const formatted = formatTraceHuman(event);
      if (!formatted) {
        continue;
      }
      if (event.kind === "run_start" && lines.length > 0) {
        lines.push("");
      }
      lines.push(formatted);
      continue;
    }
    lines.push(line);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Format an appended chat_log delta during --follow. */
export function formatChatLogDelta(rawDelta: string, raw: boolean): string {
  if (raw) {
    return rawDelta;
  }
  return formatChatLogForDisplay(rawDelta, false);
}

import { parseTraceLine, type TraceEvent } from "@comitia/shared";

export type ParsedChatLogLine =
  | { type: "legacy"; text: string }
  | { type: "trace"; event: TraceEvent };

export function parseChatLogLines(chatLog: string): ParsedChatLogLine[] {
  const lines: ParsedChatLogLine[] = [];
  for (const line of chatLog.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const event = parseTraceLine(line);
    if (event) {
      lines.push({ type: "trace", event });
      continue;
    }
    lines.push({ type: "legacy", text: line });
  }
  return lines;
}

export function traceKindClass(kind: string): string {
  switch (kind) {
    case "thinking":
      return "trace-thinking";
    case "text":
      return "trace-text";
    case "tool_call":
      return "trace-tool-call";
    case "tool_result":
      return "trace-tool-result";
    case "run_start":
    case "run_end":
      return "trace-run";
    case "continue_decision":
    case "adapter_note":
      return "trace-adapter";
    default:
      return "trace-other";
  }
}

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

export function formatTraceEventLine(event: TraceEvent): string {
  switch (event.kind) {
    case "thinking":
      return typeof event.text === "string" ? event.text : "";
    case "text":
      return typeof event.text === "string" ? event.text : "";
    case "tool_call":
      return `${String(event.tool ?? "?")} ${JSON.stringify(event.args ?? {})}`;
    case "tool_result":
      return `${String(event.tool ?? "?")} ${event.isError === true ? "ERROR" : "ok"} ${JSON.stringify(event.result ?? "")}`;
    case "adapter_note":
      return typeof event.message === "string" ? event.message : "";
    case "continue_decision":
      return `${String(event.action ?? "?")}: ${String(event.reason ?? "")}`;
    case "run_start":
      return `run ${String(event.run ?? "?")} start remaining=${String(event.remainingBudget ?? "?")}`;
    case "run_end":
      return `run ${String(event.run ?? "?")} end tokens=${String(event.tokens ?? "?")}`;
    default:
      return JSON.stringify(event);
  }
}

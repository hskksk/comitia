export const TRACE_VERSION = 1 as const;

export const TRACE_KINDS = [
  "run_start",
  "run_end",
  "thinking",
  "text",
  "tool_call",
  "tool_result",
  "adapter_note",
  "continue_decision",
] as const;

export type TraceKind = (typeof TRACE_KINDS)[number];

export type TraceEvent = {
  v: typeof TRACE_VERSION;
  seq: number;
  at: string;
  kind: TraceKind;
  run?: number;
  [key: string]: unknown;
};

export const TRACE_LINE_PREFIX = "@json ";

/** Max bytes per POST to `/v1/sessions/:id/chat-log` (M20-2). */
export const TRACE_CHUNK_MAX_BYTES = 256 * 1024;

export function isTraceLine(line: string): boolean {
  return line.startsWith(TRACE_LINE_PREFIX);
}

export function parseTraceLine(line: string): TraceEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(TRACE_LINE_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(TRACE_LINE_PREFIX.length)) as TraceEvent;
    if (parsed.v !== TRACE_VERSION || typeof parsed.seq !== "number") {
      return null;
    }
    if (typeof parsed.at !== "string" || typeof parsed.kind !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function serializeTraceEvent(event: TraceEvent): string {
  return `${TRACE_LINE_PREFIX}${JSON.stringify(event)}\n`;
}

export function serializeTraceEvents(events: TraceEvent[]): string {
  if (events.length === 0) {
    return "";
  }
  return events.map((event) => serializeTraceEvent(event).trimEnd()).join("\n") + "\n";
}

export function formatTraceHuman(event: TraceEvent): string | null {
  switch (event.kind) {
    case "run_start":
      return `[run start] n=${event.run ?? "?"} remaining=${event.remainingBudget ?? "?"}`;
    case "run_end":
      return `[run end] n=${event.run ?? "?"} tokens=${event.tokens ?? "?"}`;
    case "thinking":
      return typeof event.text === "string"
        ? `[thinking] ${event.text}`
        : null;
    case "text":
      return typeof event.text === "string" ? event.text : null;
    case "tool_call":
      return `[tool] ${String(event.tool ?? "?")}(${JSON.stringify(event.args ?? {})})`;
    case "tool_result": {
      const tool = String(event.tool ?? "?");
      if (event.isError === true) {
        return `[tool-result] ${tool} ERROR ${JSON.stringify(event.result ?? event.message ?? "")}`;
      }
      const budget =
        typeof event.remainingBudget === "number"
          ? ` remaining=${event.remainingBudget}`
          : "";
      const redacted = event.redacted === true ? " (redacted)" : "";
      const truncated = event.truncated === true ? " (truncated)" : "";
      return `[tool-result] ${tool} ok${budget}${redacted}${truncated}`;
    }
    case "adapter_note":
      return typeof event.message === "string"
        ? `[adapter] ${event.message}`
        : null;
    case "continue_decision":
      return `[adapter] continue ${String(event.action ?? "?")}: ${String(event.reason ?? "")}`;
    default:
      return null;
  }
}

export function parseChatLogTraceLines(chatLog: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of chatLog.split("\n")) {
    const parsed = parseTraceLine(line);
    if (parsed) {
      events.push(parsed);
    }
  }
  return events;
}

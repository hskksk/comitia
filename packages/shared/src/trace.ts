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

/** Client-supplied trace payload; server assigns `seq` when omitted. */
export type TraceEventInput = {
  v: typeof TRACE_VERSION;
  seq?: number;
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

const SHORT_TEXT_LIMIT = 120;

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/** Unwrap MCP text blocks and JSON strings so logs show structured values. */
export function unwrapTraceValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    return parsed === undefined ? value : unwrapTraceValue(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isTextBlock)) {
      const texts = value.map((item) => item.text);
      if (texts.length === 1) {
        return unwrapTraceValue(texts[0], depth + 1);
      }
      return texts.map((text) => unwrapTraceValue(text, depth + 1));
    }
    return value.map((item) => unwrapTraceValue(item, depth + 1));
  }
  return value;
}

function isEmptyPrettyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  ) {
    return true;
  }
  return false;
}

/** Pretty-print a trace payload for humans (CLI and Web). */
export function prettyTraceValue(value: unknown): string | null {
  const unwrapped = unwrapTraceValue(value);
  if (isEmptyPrettyValue(unwrapped)) {
    return null;
  }
  if (typeof unwrapped === "string") {
    return unwrapped;
  }
  if (typeof unwrapped === "number" || typeof unwrapped === "boolean") {
    return String(unwrapped);
  }
  try {
    return JSON.stringify(unwrapped, null, 2);
  } catch {
    return String(unwrapped);
  }
}

export type TraceHumanParts = {
  kind: TraceKind;
  headline: string;
  body: string | null;
};

function withBody(headline: string, body: string | null): {
  headline: string;
  body: string | null;
} {
  return { headline, body };
}

function splitPrefixedText(
  prefix: string,
  text: string,
): { headline: string; body: string | null } {
  if (!text.includes("\n") && text.length <= SHORT_TEXT_LIMIT) {
    return withBody(`${prefix} ${text}`, null);
  }
  return withBody(prefix, text);
}

function toolResultHeadline(event: TraceEvent, tool: string): string {
  const error = event.isError === true || event.ok === false;
  const status = error ? "ERROR" : "ok";
  const budget =
    typeof event.remainingBudget === "number"
      ? ` remaining=${event.remainingBudget}`
      : "";
  const redacted = event.redacted === true ? " (redacted)" : "";
  const truncated = event.truncated === true ? " (truncated)" : "";
  return `[tool-result] ${tool} ${status}${budget}${redacted}${truncated}`;
}

function continueDecisionBody(event: TraceEvent): string | null {
  const goals = event.incompleteGoals;
  if (!Array.isArray(goals) || goals.length === 0) {
    return null;
  }
  return prettyTraceValue(goals);
}

/** Headline + optional pretty body for one trace event. */
export function describeTraceEvent(event: TraceEvent): TraceHumanParts | null {
  switch (event.kind) {
    case "run_start":
      return {
        kind: event.kind,
        headline: `[run start] n=${event.run ?? "?"} remaining=${event.remainingBudget ?? "?"}`,
        body: null,
      };
    case "run_end":
      return {
        kind: event.kind,
        headline: `[run end] n=${event.run ?? "?"} tokens=${event.tokens ?? "?"}`,
        body: null,
      };
    case "thinking":
      if (typeof event.text !== "string") {
        return null;
      }
      return { kind: event.kind, ...splitPrefixedText("[thinking]", event.text) };
    case "text":
      if (typeof event.text !== "string") {
        return null;
      }
      return { kind: event.kind, headline: "", body: event.text };
    case "tool_call":
      return {
        kind: event.kind,
        headline: `[tool] ${String(event.tool ?? "?")}`,
        body: prettyTraceValue(event.args),
      };
    case "tool_result": {
      const tool = String(event.tool ?? "?");
      return {
        kind: event.kind,
        headline: toolResultHeadline(event, tool),
        body: prettyTraceValue(event.result ?? event.message),
      };
    }
    case "adapter_note":
      if (typeof event.message !== "string") {
        return null;
      }
      return {
        kind: event.kind,
        ...splitPrefixedText("[adapter]", event.message),
      };
    case "continue_decision":
      return {
        kind: event.kind,
        headline: `[adapter] ${String(event.action ?? "?")}: ${String(event.reason ?? "")}`,
        body: continueDecisionBody(event),
      };
    default:
      return null;
  }
}

export function formatTraceHuman(event: TraceEvent): string | null {
  const parts = describeTraceEvent(event);
  if (!parts) {
    return null;
  }
  if (!parts.body) {
    return parts.headline || null;
  }
  if (!parts.headline) {
    return parts.body;
  }
  return `${parts.headline}\n${parts.body}`;
}

/** Format a sequence of events for CLI, with a blank line before each new run. */
export function formatTraceHumanList(events: TraceEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    const human = formatTraceHuman(event);
    if (!human) {
      continue;
    }
    if (event.kind === "run_start" && parts.length > 0) {
      parts.push("");
    }
    parts.push(human);
  }
  return parts.length > 0 ? `${parts.join("\n")}\n` : "";
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

export type AppendSessionTraceRequest = {
  entries: TraceEventInput[];
};

export type AppendSessionTraceResponse = {
  ok: true;
  lastSeq: number;
};

export type SessionTraceResponse = {
  sessionId: string;
  entries: TraceEvent[];
  hasMore: boolean;
};

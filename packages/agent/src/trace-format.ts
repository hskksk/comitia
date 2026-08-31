import {
  serializeTraceEvents,
  TRACE_VERSION,
  type TraceEvent,
  type TraceKind,
} from "@comitia/shared";
import {
  TraceCoalescingUploader,
  type TraceCoalesceOptions,
} from "./trace-coalesce.js";
import { TRACE_CHUNK_MAX_BYTES } from "@comitia/shared";

export { TRACE_CHUNK_MAX_BYTES, TRACE_COALESCE_DEFAULTS } from "./trace-coalesce.js";
export type { TraceCoalesceOptions } from "./trace-coalesce.js";

export const TRACE_TEXT_LIMIT = 32 * 1024;
export const TRACE_JSON_LIMIT = 64 * 1024;

const SECRET_PATTERNS: RegExp[] = [
  /\bghs_[A-Za-z0-9_]+\b/g,
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/g,
];

export type TraceRedactMode = "full" | "tool_metadata";

export function readTraceRedactMode(
  env: NodeJS.ProcessEnv = process.env,
): TraceRedactMode {
  return env.COMITIA_TRACE_REDACT === "tool_metadata"
    ? "tool_metadata"
    : "full";
}

export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

function redactSecretsDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsDeep(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      out[key] = redactSecretsDeep(child);
    }
    return out;
  }
  return value;
}

function truncateString(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}

function truncateJson(value: unknown, limit: number): { value: unknown; truncated: boolean } {
  const serialized = JSON.stringify(value);
  if (serialized.length <= limit) {
    return { value, truncated: false };
  }
  return {
    value: { _truncated: true, preview: serialized.slice(0, limit) },
    truncated: true,
  };
}

export function normalizeToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "");
}

export function finalizeTraceEvent(
  input: Omit<TraceEvent, "v" | "seq" | "at"> & {
    seq: number;
    at?: string;
  },
  options?: { redactMode?: TraceRedactMode },
): TraceEvent {
  const redactMode = options?.redactMode ?? readTraceRedactMode();
  const at = input.at ?? new Date().toISOString();
  const base = {
    ...input,
    v: TRACE_VERSION,
    at,
  } as TraceEvent;

  const sanitized = redactSecretsDeep(base) as TraceEvent;

  if (sanitized.kind === "thinking" || sanitized.kind === "text") {
    if (typeof sanitized.text === "string") {
      const truncated = truncateString(sanitized.text, TRACE_TEXT_LIMIT);
      sanitized.text = truncated.text;
      if (truncated.truncated) {
        sanitized.truncated = true;
      }
    }
  }

  if (sanitized.kind === "tool_call" && sanitized.args !== undefined) {
    const truncated = truncateJson(sanitized.args, TRACE_JSON_LIMIT);
    sanitized.args = truncated.value;
    if (truncated.truncated) {
      sanitized.truncated = true;
    }
    if (
      redactMode === "tool_metadata" &&
      typeof sanitized.tool === "string" &&
      BODY_REDACT_TOOLS.has(sanitized.tool)
    ) {
      sanitized.args = redactToolBody(sanitized.args, "args");
      sanitized.redacted = true;
    }
  }

  if (sanitized.kind === "tool_result") {
    if (sanitized.result !== undefined) {
      const truncated = truncateJson(sanitized.result, TRACE_JSON_LIMIT);
      sanitized.result = truncated.value;
      if (truncated.truncated) {
        sanitized.truncated = true;
      }
      if (
        redactMode === "tool_metadata" &&
        typeof sanitized.tool === "string" &&
        BODY_REDACT_TOOLS.has(sanitized.tool)
      ) {
        sanitized.result = redactToolBody(sanitized.result, "result");
        sanitized.redacted = true;
      }
    }
  }

  if (sanitized.kind === "adapter_note" && typeof sanitized.message === "string") {
    const truncated = truncateString(sanitized.message, TRACE_TEXT_LIMIT);
    sanitized.message = truncated.text;
    if (truncated.truncated) {
      sanitized.truncated = true;
    }
  }

  return sanitized;
}

const BODY_REDACT_TOOLS = new Set([
  "write_note",
  "write_memory",
  "read_note",
]);

function redactToolBody(value: unknown, field: "args" | "result"): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const record = { ...(value as Record<string, unknown>) };
  for (const key of ["body", "content", "text", "title"]) {
    if (key in record) {
      record[key] = "(redacted)";
    }
  }
  return record;
}

export function ensureTraceChunkNewline(chunk: string): string {
  if (!chunk) {
    return chunk;
  }
  return chunk.endsWith("\n") ? chunk : `${chunk}\n`;
}

export type TraceSessionLogOptions = {
  redactMode?: TraceRedactMode;
  /** M20-2: coalesce and upload on each emit (non-blocking). */
  live?: boolean;
  coalesce?: TraceCoalesceOptions;
};

export class TraceSessionLog {
  private seq = 0;
  private readonly uploader: TraceCoalescingUploader | null;

  constructor(
    private readonly onChunk: (chunk: string) => Promise<void>,
    private readonly options: TraceSessionLogOptions = {},
  ) {
    this.uploader = options.live
      ? new TraceCoalescingUploader(onChunk, options.coalesce)
      : null;
  }

  emit(
    input: Omit<TraceEvent, "v" | "seq" | "at"> & { at?: string },
  ): TraceEvent {
    this.seq += 1;
    const event = finalizeTraceEvent(
      { ...input, seq: this.seq },
      { redactMode: this.options.redactMode ?? readTraceRedactMode() },
    );
    if (this.uploader) {
      this.uploader.enqueueEvent(event);
    }
    return event;
  }

  emitMany(
    inputs: Array<Omit<TraceEvent, "v" | "seq" | "at"> & { at?: string }>,
  ): TraceEvent[] {
    return inputs.map((input) => this.emit(input));
  }

  async flushPending(): Promise<void> {
    if (this.uploader) {
      await this.uploader.flushPending();
    }
  }

  async flush(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const chunk = ensureTraceChunkNewline(serializeTraceEvents(events));
    if (this.uploader) {
      this.uploader.enqueueLine(chunk.trimEnd());
      await this.uploader.flushPending();
      return;
    }
    await this.onChunk(chunk);
  }
}

function parseJsonLine(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractRemainingBudget(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = parseJsonLine(value);
    return parsed === null ? null : extractRemainingBudget(parsed);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractRemainingBudget(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.remaining_budget === "number") {
    return record.remaining_budget;
  }
  for (const child of Object.values(record)) {
    const found = extractRemainingBudget(child);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export function claudeStreamLineToPartialEvents(
  line: string,
  run: number,
): Array<Omit<TraceEvent, "v" | "seq" | "at">> {
  const trimmed = line.trim();
  if (!trimmed) {
    return [];
  }
  const event = parseJsonLine(trimmed);
  if (event === null || typeof event !== "object") {
    return [];
  }
  const record = event as Record<string, unknown>;
  const message = record.message;
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return [];
  }

  const partials: Array<Omit<TraceEvent, "v" | "seq" | "at">> = [];
  const isAssistant = record.type === "assistant";
  const isUser = record.type === "user";

  for (const block of content) {
    if (block === null || typeof block !== "object") {
      continue;
    }
    const item = block as Record<string, unknown>;
    if (isAssistant && item.type === "thinking" && typeof item.thinking === "string") {
      partials.push({ kind: "thinking", run, text: item.thinking });
    } else if (isAssistant && item.type === "text" && typeof item.text === "string") {
      partials.push({ kind: "text", run, text: item.text });
    } else if (item.type === "tool_use" && typeof item.name === "string") {
      partials.push({
        kind: "tool_call",
        run,
        tool: normalizeToolName(item.name),
        args: item.input ?? {},
        toolUseId: typeof item.id === "string" ? item.id : undefined,
      });
    } else if ((isAssistant || isUser) && item.type === "tool_result") {
      partials.push({
        kind: "tool_result",
        run,
        toolUseId:
          typeof item.tool_use_id === "string" ? item.tool_use_id : undefined,
        isError: item.is_error === true,
        ok: item.is_error !== true,
        result: item.content,
        remainingBudget: extractRemainingBudget(item.content) ?? undefined,
      });
    }
  }
  return partials;
}

export type TraceEmitSink = {
  emit(
    input: Omit<TraceEvent, "v" | "seq" | "at"> & { at?: string },
  ): TraceEvent;
};

export function parseClaudeStreamTrace(
  output: string,
  run: number,
  traceLog: TraceEmitSink,
  options?: { recordEvents?: boolean },
): {
  toolLog: Array<{
    run: number;
    tool: string;
    args: unknown;
    isError?: boolean;
    result?: unknown;
  }>;
  remainingBudget: number | null;
  tokens: number;
  events: TraceEvent[];
} {
  const toolLog: Array<{
    run: number;
    tool: string;
    args: unknown;
    isError?: boolean;
    result?: unknown;
  }> = [];
  const toolById = new Map<string, number>();
  let remainingBudget: number | null = null;
  let tokens = 0;
  const events: TraceEvent[] = [];

  const recordEvents = options?.recordEvents !== false;

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const record = parseJsonLine(line);
    if (record !== null && typeof record === "object") {
      const message = (record as Record<string, unknown>).message;
      if (message && typeof message === "object") {
        const usage = (message as Record<string, unknown>).usage;
        if (usage && typeof usage === "object") {
          const usageRecord = usage as Record<string, unknown>;
          for (const key of ["input_tokens", "output_tokens"]) {
            if (typeof usageRecord[key] === "number") {
              tokens += usageRecord[key];
            }
          }
        }
      }
    }

    for (const partial of claudeStreamLineToPartialEvents(line, run)) {
      const finalized = recordEvents
        ? traceLog.emit(partial)
        : ({
            ...partial,
            v: TRACE_VERSION,
            seq: 0,
            at: "",
          } as TraceEvent);
      if (recordEvents) {
        events.push(finalized);
      }

      if (finalized.kind === "tool_call" && typeof finalized.tool === "string") {
        const index =
          toolLog.push({
            run,
            tool: finalized.tool,
            args: finalized.args ?? {},
          }) - 1;
        if (typeof finalized.toolUseId === "string") {
          toolById.set(finalized.toolUseId, index);
        }
      }
      if (finalized.kind === "tool_result") {
        const index =
          typeof finalized.toolUseId === "string"
            ? toolById.get(finalized.toolUseId)
            : undefined;
        if (index !== undefined) {
          toolLog[index] = {
            ...toolLog[index]!,
            ...(finalized.isError === true ? { isError: true } : {}),
            result: finalized.result,
          };
          finalized.tool = toolLog[index]!.tool;
        }
        if (typeof finalized.remainingBudget === "number") {
          remainingBudget = finalized.remainingBudget;
        } else if (finalized.result !== undefined) {
          remainingBudget =
            extractRemainingBudget(finalized.result) ?? remainingBudget;
        }
      }
    }
  }

  return { toolLog, remainingBudget, tokens, events };
}

export function toolLogToTraceEvents(
  run: number,
  toolLog: Array<{
    tool: string;
    args: unknown;
    isError?: boolean;
    result?: unknown;
  }>,
  traceLog: TraceEmitSink,
): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const entry of toolLog) {
    events.push(
      traceLog.emit({
        kind: "tool_call",
        run,
        tool: entry.tool,
        args: entry.args,
      }),
    );
    events.push(
      traceLog.emit({
        kind: "tool_result",
        run,
        tool: entry.tool,
        isError: entry.isError === true,
        ok: entry.isError !== true,
        result: entry.result,
        remainingBudget: extractRemainingBudget(entry.result) ?? undefined,
      }),
    );
  }
  return events;
}

export function adapterNoteEvent(
  run: number | undefined,
  message: string,
): Omit<TraceEvent, "v" | "seq" | "at"> {
  return {
    kind: "adapter_note" satisfies TraceKind,
    ...(run !== undefined ? { run } : {}),
    message,
  };
}

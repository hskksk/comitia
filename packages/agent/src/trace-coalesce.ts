import {
  serializeTraceEvent,
  TRACE_CHUNK_MAX_BYTES,
  type TraceEvent,
} from "@comitia/shared";

export { TRACE_CHUNK_MAX_BYTES } from "@comitia/shared";

export const TRACE_COALESCE_DEFAULTS = {
  maxMs: 500,
  maxBytes: 16 * 1024,
  maxEvents: 20,
} as const;

export type TraceCoalesceOptions = {
  maxMs?: number;
  maxBytes?: number;
  maxEvents?: number;
};

function ensureTraceChunkNewline(chunk: string): string {
  if (!chunk) {
    return chunk;
  }
  return chunk.endsWith("\n") ? chunk : `${chunk}\n`;
}

function lineUtf8Bytes(line: string, withSeparator: boolean): number {
  return Buffer.byteLength(line, "utf8") + (withSeparator ? 1 : 0);
}

/** Split coalesced lines so each upload stays within Board's chunk limit. */
export function splitTraceLinesByMaxBytes(
  lines: string[],
  maxBytes: number,
): string[][] {
  if (lines.length === 0) {
    return [];
  }
  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const line of lines) {
    const addedBytes = lineUtf8Bytes(line, current.length > 0);
    if (current.length > 0 && currentBytes + addedBytes > maxBytes) {
      batches.push(current);
      current = [line];
      currentBytes = Buffer.byteLength(line, "utf8");
      continue;
    }
    current.push(line);
    currentBytes += addedBytes;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

/** Coalesce @json lines and upload via a serial, non-blocking queue. */
export class TraceCoalescingUploader {
  private pendingLines: string[] = [];
  private pendingBytes = 0;
  private pendingEvents = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private uploadChain = Promise.resolve();
  private readonly maxMs: number;
  private readonly maxBytes: number;
  private readonly maxEvents: number;

  constructor(
    private readonly onChunk: (chunk: string) => Promise<void>,
    options: TraceCoalesceOptions = {},
  ) {
    this.maxMs = options.maxMs ?? TRACE_COALESCE_DEFAULTS.maxMs;
    this.maxBytes = options.maxBytes ?? TRACE_COALESCE_DEFAULTS.maxBytes;
    this.maxEvents = options.maxEvents ?? TRACE_COALESCE_DEFAULTS.maxEvents;
  }

  enqueueLine(line: string): void {
    const normalized = line.trimEnd();
    if (!normalized) {
      return;
    }
    this.pendingLines.push(normalized);
    this.pendingBytes += lineUtf8Bytes(normalized, this.pendingLines.length > 1);
    this.pendingEvents += 1;
    if (
      this.pendingEvents >= this.maxEvents ||
      this.pendingBytes >= this.maxBytes
    ) {
      void this.flushPending();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        void this.flushPending();
      }, this.maxMs);
    }
  }

  enqueueEvent(event: TraceEvent): void {
    this.enqueueLine(serializeTraceEvent(event).trimEnd());
  }

  flushPending(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingLines.length === 0) {
      return this.uploadChain;
    }
    const lines = this.pendingLines;
    this.pendingLines = [];
    this.pendingBytes = 0;
    this.pendingEvents = 0;
    for (const batch of splitTraceLinesByMaxBytes(lines, TRACE_CHUNK_MAX_BYTES)) {
      const chunk = ensureTraceChunkNewline(batch.join("\n"));
      this.uploadChain = this.uploadChain
        .then(() => this.onChunk(chunk))
        .catch(() => undefined);
    }
    return this.uploadChain;
  }
}

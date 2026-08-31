import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRACE_VERSION } from "@comitia/shared";
import {
  TRACE_COALESCE_DEFAULTS,
  TraceCoalescingUploader,
} from "./trace-coalesce.js";

describe("TraceCoalescingUploader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes when maxEvents is reached", async () => {
    const chunks: string[] = [];
    const uploader = new TraceCoalescingUploader(
      async (chunk) => {
        chunks.push(chunk);
      },
      { maxEvents: 2, maxMs: 10_000 },
    );

    uploader.enqueueEvent({
      v: TRACE_VERSION,
      seq: 1,
      at: "t1",
      kind: "text",
      run: 1,
      text: "a",
    });
    uploader.enqueueEvent({
      v: TRACE_VERSION,
      seq: 2,
      at: "t2",
      kind: "text",
      run: 1,
      text: "b",
    });
    await uploader.flushPending();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('"kind":"text"');
    expect(chunks[0]?.endsWith("\n")).toBe(true);
  });

  it("flushes on timer when below event threshold", async () => {
    const chunks: string[] = [];
    const uploader = new TraceCoalescingUploader(async (chunk) => {
      chunks.push(chunk);
    });

    uploader.enqueueEvent({
      v: TRACE_VERSION,
      seq: 1,
      at: "t1",
      kind: "run_start",
      run: 1,
    });
    expect(chunks).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(TRACE_COALESCE_DEFAULTS.maxMs);
    await uploader.flushPending();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('"kind":"run_start"');
  });

  it("serializes uploads so a second flush waits for the first", async () => {
    vi.useRealTimers();
    const chunks: string[] = [];
    const uploader = new TraceCoalescingUploader(async (chunk) => {
      chunks.push(chunk);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    uploader.enqueueLine("@json first\n");
    const first = uploader.flushPending();
    uploader.enqueueLine("@json second\n");
    const second = uploader.flushPending();
    await Promise.all([first, second]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("first");
    expect(chunks[1]).toContain("second");
  });

  it("swallows upload errors without blocking later flushes", async () => {
    let calls = 0;
    const uploader = new TraceCoalescingUploader(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network down");
      }
    });

    uploader.enqueueLine("@json {}\n");
    await uploader.flushPending();
    uploader.enqueueLine('@json {"kind":"text"}\n');
    await uploader.flushPending();

    expect(calls).toBe(2);
  });
});

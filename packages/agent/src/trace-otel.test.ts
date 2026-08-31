import { describe, expect, it } from "vitest";
import {
  trace,
  SpanStatusCode,
  type Tracer,
} from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { TRACE_VERSION, type TraceEvent } from "@comitia/shared";
import {
  applyTraceEventToOtelState,
  COMITIA_OTEL_ENDPOINT_ENV,
  createEmptyTraceOtelSpanState,
  createTraceOtelBridge,
} from "./trace-otel.js";

function makeTracer(exporter: InMemorySpanExporter): Tracer {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  return provider.getTracer("test");
}

function baseEvent(
  partial: Omit<TraceEvent, "v" | "seq" | "at"> & {
    seq?: number;
    at?: string;
  },
): TraceEvent {
  return {
    v: TRACE_VERSION,
    seq: partial.seq ?? 1,
    at: partial.at ?? "2026-08-31T12:00:00.000Z",
    ...partial,
  } as TraceEvent;
}

describe("trace otel export", () => {
  it("is a noop when COMITIA_OTEL_ENDPOINT is unset", async () => {
    const previous = process.env[COMITIA_OTEL_ENDPOINT_ENV];
    delete process.env[COMITIA_OTEL_ENDPOINT_ENV];
    try {
      const bridge = createTraceOtelBridge({ sessionId: "sess-1" });
      expect(() => bridge.onEvent(baseEvent({ kind: "run_start", run: 1 }))).not.toThrow();
      await bridge.shutdown();
    } finally {
      if (previous === undefined) {
        delete process.env[COMITIA_OTEL_ENDPOINT_ENV];
      } else {
        process.env[COMITIA_OTEL_ENDPOINT_ENV] = previous;
      }
    }
  });

  it("maps run and tool spans with GenAI attributes", () => {
    const exporter = new InMemorySpanExporter();
    const tracer = makeTracer(exporter);
    const state = createEmptyTraceOtelSpanState();

    applyTraceEventToOtelState(
      baseEvent({ kind: "run_start", run: 1, seq: 1 }),
      state,
      tracer,
      "sess-1",
    );
    applyTraceEventToOtelState(
      baseEvent({
        kind: "tool_call",
        run: 1,
        seq: 2,
        tool: "get_briefing",
        args: {},
        toolUseId: "tu-1",
      }),
      state,
      tracer,
      "sess-1",
    );
    applyTraceEventToOtelState(
      baseEvent({
        kind: "tool_result",
        run: 1,
        seq: 3,
        toolUseId: "tu-1",
        ok: true,
      }),
      state,
      tracer,
      "sess-1",
    );
    applyTraceEventToOtelState(
      baseEvent({ kind: "run_end", run: 1, seq: 4, tokens: 42 }),
      state,
      tracer,
      "sess-1",
    );
    state.sessionSpan?.end();

    const spans = exporter.getFinishedSpans();
    const names = spans.map((span) => span.name);
    expect(names).toContain("comitia.session");
    expect(names).toContain("comitia.run");
    expect(names).toContain("gen_ai.execute_tool");

    const toolSpan = spans.find((span) => span.name === "gen_ai.execute_tool");
    expect(toolSpan?.attributes["gen_ai.tool.name"]).toBe("get_briefing");
    expect(toolSpan?.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(toolSpan?.status.code).toBe(SpanStatusCode.OK);

    const runSpan = spans.find((span) => span.name === "comitia.run");
    expect(runSpan?.attributes["comitia.run"]).toBe(1);
  });

  it("marks tool_result errors on the span", () => {
    const exporter = new InMemorySpanExporter();
    const tracer = makeTracer(exporter);
    const state = createEmptyTraceOtelSpanState();

    applyTraceEventToOtelState(
      baseEvent({ kind: "run_start", run: 1, seq: 1 }),
      state,
      tracer,
      "sess-1",
    );
    applyTraceEventToOtelState(
      baseEvent({
        kind: "tool_call",
        run: 1,
        seq: 2,
        tool: "write_note",
        args: {},
      }),
      state,
      tracer,
      "sess-1",
    );
    applyTraceEventToOtelState(
      baseEvent({
        kind: "tool_result",
        run: 1,
        seq: 3,
        isError: true,
        message: "denied",
      }),
      state,
      tracer,
      "sess-1",
    );

    const toolSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.execute_tool");
    expect(toolSpan?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("createTraceOtelBridge exports spans through an injected processor", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("test");
    const bridge = createTraceOtelBridge({
      sessionId: "sess-2",
      tracer,
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    bridge.onEvent(baseEvent({ kind: "run_start", run: 2, seq: 1 }));
    bridge.onEvent(
      baseEvent({
        kind: "tool_call",
        run: 2,
        seq: 2,
        tool: "set_goals",
        args: {},
      }),
    );
    await bridge.shutdown();

    expect(exporter.getFinishedSpans().some((span) => span.name === "comitia.run")).toBe(
      true,
    );
    expect(
      exporter.getFinishedSpans().some((span) => span.name === "gen_ai.execute_tool"),
    ).toBe(true);
  });
});

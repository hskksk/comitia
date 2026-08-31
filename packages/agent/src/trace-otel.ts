import {
  context,
  trace,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { TraceEvent } from "@comitia/shared";

export const COMITIA_OTEL_ENDPOINT_ENV = "COMITIA_OTEL_ENDPOINT";
export const COMITIA_OTEL_SERVICE_NAME_ENV = "COMITIA_OTEL_SERVICE_NAME";

const GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
const GEN_AI_TOOL_NAME = "gen_ai.tool.name";
const COMITIA_SESSION_ID = "comitia.session_id";
const COMITIA_RUN = "comitia.run";
const COMITIA_TRACE_SEQ = "comitia.trace_seq";

export type TraceOtelBridge = {
  onEvent(event: TraceEvent): void;
  shutdown(): Promise<void>;
};

export type TraceOtelSpanState = {
  sessionSpan: Span | null;
  runSpans: Map<number, Span>;
  toolSpans: Map<string, Span>;
  openToolStack: string[];
};

export type TraceOtelBridgeOptions = {
  sessionId: string;
  endpoint?: string;
  serviceName?: string;
  tracer?: Tracer;
  spanProcessor?: SpanProcessor;
};

export function createEmptyTraceOtelSpanState(): TraceOtelSpanState {
  return {
    sessionSpan: null,
    runSpans: new Map(),
    toolSpans: new Map(),
    openToolStack: [],
  };
}

function toolSpanKey(run: number | undefined, toolUseId: string): string {
  return `${run ?? 0}:${toolUseId}`;
}

function readToolUseId(event: TraceEvent): string | undefined {
  const value = event.toolUseId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRun(event: TraceEvent): number | undefined {
  return typeof event.run === "number" ? event.run : undefined;
}

/** Map TraceEvent kinds to GenAI-style spans (testable without network). */
export function applyTraceEventToOtelState(
  event: TraceEvent,
  state: TraceOtelSpanState,
  tracer: Tracer,
  sessionId: string,
): void {
  const run = readRun(event);
  const baseAttributes = {
    [COMITIA_SESSION_ID]: sessionId,
    [COMITIA_TRACE_SEQ]: event.seq,
    ...(run !== undefined ? { [COMITIA_RUN]: run } : {}),
  };

  switch (event.kind) {
    case "run_start": {
      if (!state.sessionSpan) {
        state.sessionSpan = tracer.startSpan("comitia.session", {
          attributes: baseAttributes,
        });
      }
      const parentContext = state.sessionSpan
        ? trace.setSpan(context.active(), state.sessionSpan)
        : context.active();
      const runSpan = tracer.startSpan(
        "comitia.run",
        {
          attributes: {
            ...baseAttributes,
            [GEN_AI_OPERATION_NAME]: "run",
          },
        },
        parentContext,
      );
      if (run !== undefined) {
        state.runSpans.set(run, runSpan);
      }
      break;
    }
    case "run_end": {
      const runSpan = run !== undefined ? state.runSpans.get(run) : undefined;
      if (runSpan) {
        if (typeof event.tokens === "number") {
          runSpan.setAttribute("comitia.tokens", event.tokens);
        }
        runSpan.end();
        if (run !== undefined) {
          state.runSpans.delete(run);
        }
      }
      break;
    }
    case "tool_call": {
      const toolName = typeof event.tool === "string" ? event.tool : "unknown";
      const parentRunSpan =
        run !== undefined ? state.runSpans.get(run) : undefined;
      const parentContext = parentRunSpan
        ? trace.setSpan(context.active(), parentRunSpan)
        : state.sessionSpan
          ? trace.setSpan(context.active(), state.sessionSpan)
          : context.active();
      const toolSpan = tracer.startSpan(
        "gen_ai.execute_tool",
        {
          attributes: {
            ...baseAttributes,
            [GEN_AI_OPERATION_NAME]: "execute_tool",
            [GEN_AI_TOOL_NAME]: toolName,
          },
        },
        parentContext,
      );
      const toolUseId = readToolUseId(event) ?? `seq-${event.seq}`;
      const key = toolSpanKey(run, toolUseId);
      state.toolSpans.set(key, toolSpan);
      state.openToolStack.push(key);
      break;
    }
    case "tool_result": {
      const toolUseId = readToolUseId(event);
      let key =
        toolUseId !== undefined ? toolSpanKey(run, toolUseId) : undefined;
      if (key === undefined || !state.toolSpans.has(key)) {
        key = state.openToolStack.pop();
      }
      const toolSpan = key ? state.toolSpans.get(key) : undefined;
      if (!toolSpan) {
        break;
      }
      const toolName = typeof event.tool === "string" ? event.tool : undefined;
      if (toolName) {
        toolSpan.setAttribute(GEN_AI_TOOL_NAME, toolName);
      }
      if (event.isError === true) {
        toolSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message:
            typeof event.message === "string"
              ? event.message
              : "tool error",
        });
      } else {
        toolSpan.setStatus({ code: SpanStatusCode.OK });
      }
      toolSpan.end();
      if (key !== undefined) {
        state.toolSpans.delete(key);
      }
      break;
    }
    default:
      break;
  }
}

function endOpenSpans(state: TraceOtelSpanState): void {
  for (const span of state.toolSpans.values()) {
    span.end();
  }
  state.toolSpans.clear();
  state.openToolStack.length = 0;
  for (const span of state.runSpans.values()) {
    span.end();
  }
  state.runSpans.clear();
  state.sessionSpan?.end();
  state.sessionSpan = null;
}

function noopBridge(): TraceOtelBridge {
  return {
    onEvent() {},
    shutdown: async () => {},
  };
}

export function createTraceOtelBridge(
  options: TraceOtelBridgeOptions,
): TraceOtelBridge {
  const endpoint =
    options.endpoint?.trim() ||
    process.env[COMITIA_OTEL_ENDPOINT_ENV]?.trim();
  if (!endpoint && !options.tracer) {
    return noopBridge();
  }

  const serviceName =
    options.serviceName?.trim() ||
    process.env[COMITIA_OTEL_SERVICE_NAME_ENV]?.trim() ||
    "comitia-agent";

  let provider: BasicTracerProvider | null = null;
  const tracer =
    options.tracer ??
    (() => {
      provider = new BasicTracerProvider({
        resource: new Resource({
          [ATTR_SERVICE_NAME]: serviceName,
        }),
        spanProcessors: [
          options.spanProcessor ??
            new SimpleSpanProcessor(
              new OTLPTraceExporter({ url: endpoint }),
            ),
        ],
      });
      trace.setGlobalTracerProvider(provider);
      return provider.getTracer("comitia-agent");
    })();

  const state = createEmptyTraceOtelSpanState();

  return {
    onEvent(event: TraceEvent) {
      applyTraceEventToOtelState(event, state, tracer, options.sessionId);
    },
    async shutdown() {
      endOpenSpans(state);
      await provider?.shutdown();
    },
  };
}

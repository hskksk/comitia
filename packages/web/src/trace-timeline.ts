import { prettyTraceValue, type TraceEvent } from "@comitia/shared";

export type TraceTimelineFilters = {
  hideThinking: boolean;
  toolsOnly: boolean;
};

export type TraceTimelineItem =
  | { type: "trace"; event: TraceEvent }
  | { type: "legacy"; text: string };

export function filterTraceEntries(
  entries: TraceEvent[],
  filters: TraceTimelineFilters,
): TraceEvent[] {
  return entries.filter((entry) => matchesTraceFilters(entry, filters));
}

export function filterTimelineItems(
  items: TraceTimelineItem[],
  filters: TraceTimelineFilters,
): TraceTimelineItem[] {
  return items.filter((item) => {
    if (item.type === "legacy") {
      return !filters.toolsOnly;
    }
    return matchesTraceFilters(item.event, filters);
  });
}

function matchesTraceFilters(
  entry: TraceEvent,
  filters: TraceTimelineFilters,
): boolean {
  if (filters.toolsOnly) {
    return entry.kind === "tool_call" || entry.kind === "tool_result";
  }
  if (filters.hideThinking && entry.kind === "thinking") {
    return false;
  }
  return true;
}

export function isTraceResultError(entry: TraceEvent): boolean {
  return entry.kind === "tool_result" && (entry.isError === true || entry.ok === false);
}

export function traceEntryTitle(entry: TraceEvent): string {
  switch (entry.kind) {
    case "tool_call":
    case "tool_result":
      return String(entry.tool ?? "?");
    case "run_start":
      return `n=${entry.run ?? "?"} 残量 ${entry.remainingBudget ?? "?"}`;
    case "run_end":
      return `n=${entry.run ?? "?"} tokens ${entry.tokens ?? "?"}`;
    case "continue_decision":
      return `${String(entry.action ?? "?")}: ${String(entry.reason ?? "")}`;
    default:
      return "";
  }
}

export function traceEntryStatus(entry: TraceEvent): string | null {
  if (entry.kind !== "tool_result") {
    return null;
  }
  if (isTraceResultError(entry)) {
    return "エラー";
  }
  const bits = ["ok"];
  if (typeof entry.remainingBudget === "number") {
    bits.push(`残量 ${entry.remainingBudget}`);
  }
  if (entry.redacted === true) {
    bits.push("redacted");
  }
  if (entry.truncated === true) {
    bits.push("truncated");
  }
  return bits.join(" · ");
}

export function traceEntryBody(entry: TraceEvent): string | null {
  switch (entry.kind) {
    case "thinking":
    case "text":
      return typeof entry.text === "string" && entry.text.length > 0
        ? entry.text
        : null;
    case "tool_call":
      return prettyTraceValue(entry.args);
    case "tool_result":
      return prettyTraceValue(entry.result ?? entry.message);
    case "adapter_note":
      return typeof entry.message === "string" ? entry.message : null;
    case "continue_decision":
      return prettyTraceValue(entry.incompleteGoals);
    default:
      return null;
  }
}

export function traceBodyAs(entry: TraceEvent): "markdown" | "pre" {
  return entry.kind === "text" ? "markdown" : "pre";
}

export function toTimelineItems(entries: TraceEvent[]): TraceTimelineItem[] {
  return entries.map((event) => ({ type: "trace", event }));
}

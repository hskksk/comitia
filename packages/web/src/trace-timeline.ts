import { formatTraceHuman, type TraceEvent } from "@comitia/shared";

export type TraceTimelineFilters = {
  hideThinking: boolean;
  toolsOnly: boolean;
};

export function filterTraceEntries(
  entries: TraceEvent[],
  filters: TraceTimelineFilters,
): TraceEvent[] {
  return entries.filter((entry) => {
    if (filters.toolsOnly) {
      return entry.kind === "tool_call" || entry.kind === "tool_result";
    }
    if (filters.hideThinking && entry.kind === "thinking") {
      return false;
    }
    return true;
  });
}

export function isTraceEntryCollapsible(entry: TraceEvent): boolean {
  return entry.kind === "thinking";
}

export function formatTraceTimelineLine(entry: TraceEvent): string {
  return formatTraceHuman(entry) ?? JSON.stringify(entry);
}

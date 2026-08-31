import { useState } from "react";
import type { TraceEvent } from "@comitia/shared";
import { traceKindClass } from "./trace-log.js";
import {
  filterTraceEntries,
  formatTraceTimelineLine,
  isTraceEntryCollapsible,
  type TraceTimelineFilters,
} from "./trace-timeline.js";

type SessionTraceTimelineProps = {
  entries: TraceEvent[];
  filters: TraceTimelineFilters;
};

export function SessionTraceTimeline({
  entries,
  filters,
}: SessionTraceTimelineProps) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const visible = filterTraceEntries(entries, filters);

  return (
    <pre className="chat-log chat-log-trace">
      {visible.map((entry) => {
        const key = entry.seq;
        const collapsible = isTraceEntryCollapsible(entry);
        const isCollapsed = collapsible && collapsed[key] === true;
        return (
          <span
            key={`trace-${key}`}
            className={traceKindClass(entry.kind)}
          >
            <span className="trace-meta">
              [{entry.at}] {entry.kind}
              {entry.run !== undefined ? ` run=${entry.run}` : ""}
              {collapsible ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="trace-collapse-btn"
                    onClick={() =>
                      setCollapsed((state) => ({
                        ...state,
                        [key]: !state[key],
                      }))
                    }
                  >
                    {isCollapsed ? "展開" : "折りたたむ"}
                  </button>
                </>
              ) : null}
            </span>
            {"\n"}
            {isCollapsed ? "…\n" : `${formatTraceTimelineLine(entry)}\n`}
          </span>
        );
      })}
    </pre>
  );
}

export type { TraceTimelineFilters };

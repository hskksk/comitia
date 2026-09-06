import type { TraceEvent } from "@comitia/shared";
import { CollapsibleMarkdown } from "./components/CollapsibleMarkdown.js";
import { traceKindLabel } from "./labels.js";
import { formatTraceClock } from "./relativeTime.js";
import { traceKindClass } from "./trace-log.js";
import {
  filterTimelineItems,
  isTraceResultError,
  traceBodyAs,
  traceEntryBody,
  traceEntryStatus,
  traceEntryTitle,
  type TraceTimelineFilters,
  type TraceTimelineItem,
} from "./trace-timeline.js";

type SessionTraceTimelineProps = {
  items: TraceTimelineItem[];
  filters: TraceTimelineFilters;
};

function TraceEntryBody({ event }: { event: TraceEvent }) {
  const body = traceEntryBody(event);
  if (!body) {
    return null;
  }
  const as = traceBodyAs(event);
  return (
    <CollapsibleMarkdown
      source={body}
      as={as}
      previewLines={as === "pre" ? 14 : 8}
      className={
        as === "pre" ? "trace-entry-body" : "trace-entry-body is-markdown"
      }
    />
  );
}

export function SessionTraceTimeline({
  items,
  filters,
}: SessionTraceTimelineProps) {
  const visible = filterTimelineItems(items, filters);

  if (visible.length === 0) {
    return <p className="status status-empty">表示するログはありません</p>;
  }

  return (
    <ol className="trace-timeline">
      {visible.map((item, index) => {
        if (item.type === "legacy") {
          return (
            <li key={`legacy-${index}`} className="trace-entry trace-legacy">
              <pre className="trace-entry-body">{item.text}</pre>
            </li>
          );
        }
        const { event } = item;
        const title = traceEntryTitle(event);
        const status = traceEntryStatus(event);
        const error = isTraceResultError(event);
        return (
          <li
            key={`trace-${event.seq}-${index}`}
            className={`trace-entry ${traceKindClass(event.kind)}${error ? " is-error" : ""}`}
          >
            <header className="trace-entry-head">
              <span className="badge trace-kind-badge">
                {traceKindLabel(event.kind)}
              </span>
              {title ? <span className="trace-entry-title">{title}</span> : null}
              {status ? (
                <span className={`trace-entry-status${error ? " is-error" : ""}`}>
                  {status}
                </span>
              ) : null}
              <time
                className="trace-entry-time muted"
                dateTime={event.at}
                title={event.at}
              >
                {formatTraceClock(event.at)}
              </time>
              {event.run !== undefined ? (
                <span className="muted">run {event.run}</span>
              ) : null}
            </header>
            <TraceEntryBody event={event} />
          </li>
        );
      })}
    </ol>
  );
}

export type { TraceTimelineFilters, TraceTimelineItem };

import { useCallback, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { serializeTraceEvents } from "@comitia/shared";
import {
  boardClient,
  type ChatLogResponse,
  type SessionTraceResponse,
} from "../api.js";
import { projectPath } from "../projectContext.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";
import {
  SessionTraceTimeline,
  type TraceTimelineFilters,
  type TraceTimelineItem,
} from "../SessionTraceTimeline.js";
import { parseChatLogLines } from "../trace-log.js";
import { toTimelineItems } from "../trace-timeline.js";

const TRACE_PAGE_SIZE = 100;

function lastSeq(entries: SessionTraceResponse["entries"]): number {
  const seq = Number(entries.at(-1)?.seq ?? 0);
  return Number.isFinite(seq) ? seq : 0;
}

export function SessionLogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<ChatLogResponse | null>(null);
  const [trace, setTrace] = useState<SessionTraceResponse | null>(null);
  const lastTraceSeqRef = useRef(0);
  const [fromStart, setFromStart] = useState(false);
  const [rawView, setRawView] = useState(false);
  const [filters, setFilters] = useState<TraceTimelineFilters>({
    hideThinking: false,
    toolsOnly: false,
  });
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLog(null);
    setTrace(null);
    lastTraceSeqRef.current = 0;
    setError(null);
  }, []);

  const load = useCallback(() => {
    if (!id) {
      return;
    }

    boardClient
      .chatLog(id, fromStart ? { fromStart: true } : { tailChars: 65_536 })
      .then(setLog)
      .catch((err: Error) => setError(err.message));

    void (async () => {
      try {
        const entries: SessionTraceResponse["entries"] = [];
        let afterSeq = 0;
        let sessionId = id;
        let hasMore = true;
        while (hasMore) {
          const page = await boardClient.sessionTrace(id, {
            afterSeq,
            limit: TRACE_PAGE_SIZE,
          });
          const pageEntries = page.entries ?? [];
          if (pageEntries.length === 0) {
            break;
          }
          const nextSeq = lastSeq(pageEntries);
          if (nextSeq <= afterSeq) {
            break;
          }
          entries.push(...pageEntries);
          afterSeq = nextSeq;
          sessionId = page.sessionId;
          hasMore = page.hasMore === true;
          lastTraceSeqRef.current = afterSeq;
          setTrace({
            sessionId,
            entries: [...entries],
            hasMore,
          });
        }
        if (entries.length === 0) {
          setTrace(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [id, fromStart]);

  const pollTrace = useCallback(() => {
    if (!id || !trace) {
      load();
      return;
    }
    boardClient
      .sessionTrace(id, { afterSeq: lastTraceSeqRef.current, limit: 500 })
      .then((next) => {
        if (next.entries.length === 0) {
          return;
        }
        setTrace((current) => {
          const base = current?.entries ?? [];
          const merged = [...base, ...next.entries];
          lastTraceSeqRef.current = lastSeq(merged);
          return {
            sessionId: next.sessionId,
            entries: merged,
            hasMore: next.hasMore,
          };
        });
      })
      .catch((err: Error) => setError(err.message));
  }, [id, load, trace]);

  useRouteLoad(load, [id, fromStart], reset);
  useFocusPoll(
    trace && !log?.endedAt ? pollTrace : load,
    log?.endedAt ? 30_000 : 8_000,
  );

  if (!projectId) {
    return null;
  }
  if (error && !log && !trace) {
    return <p className="status status-error">{error}</p>;
  }
  if (!log && !trace) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const parsedLines = log ? parseChatLogLines(log.chatLog) : [];
  const hasTrace = trace
    ? trace.entries.length > 0
    : parsedLines.some((line) => line.type === "trace");
  const useStructuredTrace = trace !== null && trace.entries.length > 0;
  const timelineItems: TraceTimelineItem[] = useStructuredTrace
    ? toTimelineItems(trace!.entries)
    : parsedLines;
  const rawChatLog =
    log?.chatLog ||
    (useStructuredTrace ? serializeTraceEvents(trace!.entries) : "");

  return (
    <article>
      <Link to={projectPath(projectId, "participants")} className="back-link">
        参加者へ
      </Link>
      <h1>チャットログ</h1>
      <p className="muted">
        {log?.endedAt ? "終了済み" : "開いているセッション"}
        {log?.truncated ? " · 末尾を表示" : ""}
        {useStructuredTrace ? " · 構造化トレース" : ""}
      </p>
      <div className="log-toolbar">
        {log?.truncated ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setFromStart(true)}
          >
            先頭から
          </button>
        ) : null}
        {hasTrace ? (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRawView((value) => !value)}
            >
              {rawView ? "トレース表示" : "生テキスト"}
            </button>
            <button
              type="button"
              className={`btn-secondary${filters.hideThinking ? " is-active" : ""}`}
              onClick={() =>
                setFilters((state) => ({
                  ...state,
                  hideThinking: !state.hideThinking,
                  toolsOnly: false,
                }))
              }
            >
              thinking を隠す
            </button>
            <button
              type="button"
              className={`btn-secondary${filters.toolsOnly ? " is-active" : ""}`}
              onClick={() =>
                setFilters((state) => ({
                  ...state,
                  toolsOnly: !state.toolsOnly,
                  hideThinking: false,
                }))
              }
            >
              ツールだけ
            </button>
          </>
        ) : null}
      </div>
      {error ? <p className="status status-error">{error}</p> : null}
      {rawView || !hasTrace ? (
        <pre className="chat-log">
          {rawChatLog || "このセッションのチャットログは空です"}
        </pre>
      ) : (
        <SessionTraceTimeline items={timelineItems} filters={filters} />
      )}
    </article>
  );
}

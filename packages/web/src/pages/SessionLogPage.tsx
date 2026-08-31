import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type ChatLogResponse } from "../api.js";
import { projectPath } from "../projectContext.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";
import {
  formatTraceEventLine,
  parseChatLogLines,
  traceKindClass,
} from "../trace-log.js";

export function SessionLogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<ChatLogResponse | null>(null);
  const [fromStart, setFromStart] = useState(false);
  const [rawView, setRawView] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLog(null);
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
  }, [id, fromStart]);

  useRouteLoad(load, [id, fromStart], reset);
  useFocusPoll(load, log?.endedAt ? 30_000 : 8_000);

  if (!projectId) {
    return null;
  }
  if (error && !log) {
    return <p className="status status-error">{error}</p>;
  }
  if (!log) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const parsedLines = parseChatLogLines(log.chatLog);
  const hasTrace = parsedLines.some((line) => line.type === "trace");

  return (
    <article>
      <Link to={projectPath(projectId, "participants")} className="back-link">
        参加者へ
      </Link>
      <h1>チャットログ</h1>
      <p className="muted">
        {log.endedAt ? "終了済み" : "開いているセッション"}
        {log.truncated ? " · 末尾を表示" : ""}
      </p>
      <div className="log-toolbar">
        {log.truncated ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setFromStart(true)}
          >
            先頭から
          </button>
        ) : null}
        {hasTrace ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setRawView((value) => !value)}
          >
            {rawView ? "トレース表示" : "生テキスト"}
          </button>
        ) : null}
      </div>
      {error ? <p className="status status-error">{error}</p> : null}
      {rawView || !hasTrace ? (
        <pre className="chat-log">{log.chatLog || "(空)"}</pre>
      ) : (
        <pre className="chat-log chat-log-trace">
          {parsedLines.map((line, index) =>
            line.type === "legacy" ? (
              <span key={`legacy-${index}`} className="trace-legacy">
                {line.text}
                {"\n"}
              </span>
            ) : (
              <span
                key={`trace-${line.event.seq}-${index}`}
                className={traceKindClass(line.event.kind)}
              >
                <span className="trace-meta">
                  [{line.event.at}] {line.event.kind}
                  {line.event.run !== undefined ? ` run=${line.event.run}` : ""}
                </span>
                {"\n"}
                {formatTraceEventLine(line.event)}
                {"\n"}
              </span>
            ),
          )}
        </pre>
      )}
    </article>
  );
}

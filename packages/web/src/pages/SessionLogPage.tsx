import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type ChatLogResponse } from "../api.js";
import { useFocusPoll } from "../useFocusPoll.js";

export function SessionLogPage() {
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<ChatLogResponse | null>(null);
  const [fromStart, setFromStart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) {
      return;
    }
    boardClient
      .chatLog(id, fromStart ? { fromStart: true } : { tailChars: 65_536 })
      .then(setLog)
      .catch((err: Error) => setError(err.message));
  }, [id, fromStart]);

  useEffect(() => {
    load();
  }, [load]);
  useFocusPoll(load, log?.endedAt ? 30_000 : 8_000);

  if (error && !log) {
    return <p className="status status-error">{error}</p>;
  }
  if (!log) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  return (
    <article>
      <Link to="/participants" className="back-link">
        参加者へ
      </Link>
      <h1>チャットログ</h1>
      <p className="muted">
        {log.endedAt ? "終了済み" : "開いているセッション"}
        {log.truncated ? " · 末尾を表示" : ""}
      </p>
      {log.truncated ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setFromStart(true)}
        >
          先頭から
        </button>
      ) : null}
      {error ? <p className="status status-error">{error}</p> : null}
      <pre className="chat-log">{log.chatLog || "(空)"}</pre>
    </article>
  );
}

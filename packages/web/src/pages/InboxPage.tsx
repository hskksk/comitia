import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type InboxItem } from "../api.js";

const KIND_LABEL = {
  merge_wait: "マージ待ち",
  post_review: "事後レビュー",
} as const;

export function InboxPage() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  const reload = useCallback(() => {
    boardClient
      .inbox()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function complete(threadId: string) {
    setError(null);
    setIsCompleting(true);
    try {
      await boardClient.declare(threadId, { kind: "complete_thread" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsCompleting(false);
    }
  }

  if (error && !items) {
    return <p className="error">{error}</p>;
  }
  if (!items) {
    return <p className="muted">読み込み中…</p>;
  }
  if (items.length === 0) {
    return <p>非ブロッキングな作業はありません</p>;
  }

  return (
    <section>
      <h1>非ブロッキング</h1>
      <p className="muted">
        判断ではない人間作業。GitHub の PR 同期は M5。今は決定済みの実装・レビュースレッドが並ぶ。
      </p>
      {items.map((item) => (
        <article key={item.threadId} className="card">
          <h2>
            <Link to={`/threads/${item.threadId}`}>{item.title}</Link>
          </h2>
          <p className="muted">{KIND_LABEL[item.kind]}</p>
          {item.latestReport ? <p>{item.latestReport.body}</p> : null}
          <div className="actions">
            <button
              type="button"
              disabled={isCompleting}
              onClick={() => void complete(item.threadId)}
            >
              完了にする
            </button>
          </div>
        </article>
      ))}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type InboxItem } from "../api.js";
import { MarkdownBody } from "../components/MarkdownBody.js";
import { pullRequestStateLabel } from "../labels.js";

const KIND_LABEL = {
  merge_wait: "マージ待ち",
  post_review: "事後レビュー",
} as const;

export function InboxPage() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  const reload = useCallback(() => {
    return boardClient
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
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsCompleting(false);
    }
  }

  if (error && !items) {
    return <p className="status status-error">{error}</p>;
  }
  if (!items) {
    return <p className="status status-loading">読み込み中…</p>;
  }
  if (items.length === 0) {
    return <p className="status status-empty">非ブロッキングな作業はありません</p>;
  }

  return (
    <section>
      <h1>非ブロッキング</h1>
      <p className="muted">
        判断ではない人間作業。決定済みの実装・レビュースレッドとリンク済み PR が並ぶ。
      </p>
      {items.map((item) => (
        <article key={item.threadId} className="card">
          <h2>
            <Link to={`/threads/${item.threadId}`}>{item.title}</Link>
          </h2>
          <p className="muted">{KIND_LABEL[item.kind]}</p>
          {item.latestReport ? (
            <MarkdownBody source={item.latestReport.body} />
          ) : null}
          {item.pullRequests.map((pr) => (
            <p key={pr.number}>
              #{pr.number} {pullRequestStateLabel(pr.state)}{" "}
              <a href={pr.url}>GitHub</a>
            </p>
          ))}
          <div className="actions">
            <button
              type="button"
              className="btn-primary"
              disabled={isCompleting}
              onClick={() => void complete(item.threadId)}
            >
              完了にする
            </button>
          </div>
        </article>
      ))}
      {error ? <p className="status status-error">{error}</p> : null}
    </section>
  );
}

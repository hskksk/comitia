import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type QueueItem } from "../api.js";

export function QueuePage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    boardClient
      .queue()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!items) {
    return <p className="muted">読み込み中…</p>;
  }
  if (items.length === 0) {
    return <p>判断待ちはありません</p>;
  }

  return (
    <section>
      <h1>判断キュー</h1>
      {items.map((item) => (
        <article key={item.threadId} className="card">
          <h2>
            <Link to={`/threads/${item.threadId}`}>{item.title}</Link>
          </h2>
          <p className="muted">
            {item.consensusType ?? "合意種類なし"} · {item.enteredAt}
          </p>
          <p>{item.synthesis?.body ?? "争点要約はまだありません"}</p>
        </article>
      ))}
    </section>
  );
}

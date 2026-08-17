import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type ThreadListItem } from "../api.js";
import { ThreadBadges } from "../components/Badges.js";

export function ThreadsPage() {
  const [items, setItems] = useState<ThreadListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    boardClient
      .threads()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <p className="status status-error">{error}</p>;
  }
  if (!items) {
    return <p className="status status-loading">読み込み中…</p>;
  }
  if (items.length === 0) {
    return <p className="status status-empty">スレッドはまだありません</p>;
  }

  return (
    <section>
      <h1>スレッド</h1>
      {items.map((item) => (
        <article key={item.id} className="card">
          <h2>
            <Link to={`/threads/${item.id}`}>{item.title}</Link>
          </h2>
          <ThreadBadges
            type={item.type}
            state={item.state}
            consensusType={item.consensusType}
          />
        </article>
      ))}
    </section>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type ThreadListItem } from "../api.js";
import { threadStateLabel, threadTypeLabel } from "../labels.js";

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
    return <p className="error">{error}</p>;
  }
  if (!items) {
    return <p className="muted">読み込み中…</p>;
  }

  return (
    <section>
      <h1>スレッド</h1>
      {items.map((item) => (
        <article key={item.id} className="card">
          <h2>
            <Link to={`/threads/${item.id}`}>{item.title}</Link>
          </h2>
          <p className="muted">
            {threadTypeLabel(item.type)} · {threadStateLabel(item.state)}
          </p>
        </article>
      ))}
    </section>
  );
}

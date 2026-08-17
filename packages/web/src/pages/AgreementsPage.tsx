import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type AgreementItem } from "../api.js";
import { MarkdownBody } from "../components/MarkdownBody.js";
import { useFocusPoll } from "../useFocusPoll.js";

export function AgreementsPage() {
  const [items, setItems] = useState<AgreementItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    boardClient
      .agreements()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);
  useFocusPoll(load, 20_000);

  if (error) {
    return <p className="status status-error">{error}</p>;
  }
  if (!items) {
    return <p className="status status-loading">読み込み中…</p>;
  }
  if (items.length === 0) {
    return <p className="status status-empty">有効な合意はまだありません</p>;
  }

  return (
    <section>
      <h1>提案集</h1>
      {items.map((item) => (
        <article key={item.id} className="card">
          <h2>
            <Link to={`/threads/${item.threadId}`}>
              {item.threadTitle ?? "スレッド"}
            </Link>
          </h2>
          <p className="muted">{item.binding ? "拘束力あり" : "拘束力なし"}</p>
          <MarkdownBody source={item.summary} />
        </article>
      ))}
    </section>
  );
}

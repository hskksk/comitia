import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type QueueItem } from "../api.js";
import {
  consensusTypeLabel,
  threadStateLabel,
  threadTypeLabel,
} from "../labels.js";

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
        <Link
          key={item.threadId}
          to={`/threads/${item.threadId}`}
          className="card"
        >
          <h2>{item.title}</h2>
          <p className="muted">
            {threadTypeLabel(item.type)} · {threadStateLabel(item.state)} ·{" "}
            {consensusTypeLabel(item.consensusType)}
          </p>
          <h3>争点要約</h3>
          <p>{item.synthesis?.body ?? "争点要約はまだありません"}</p>
          <h3>
            {item.candidateProposal
              ? `候補提案 v${item.candidateProposal.versionNumber}`
              : "候補提案"}
          </h3>
          <p>{item.candidateProposal?.content ?? "候補は未選定です"}</p>
        </Link>
      ))}
    </section>
  );
}

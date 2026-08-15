import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { boardClient, type HumanThreadView } from "../api.js";
import { SynthesisCard } from "../components/SynthesisCard.js";
import {
  consensusTypeLabel,
  postTypeLabel,
  threadStateLabel,
  threadTypeLabel,
} from "../labels.js";

export function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<HumanThreadView | null>(null);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeclaring, setIsDeclaring] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    boardClient
      .thread(id)
      .then(setView)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function runDeclare(payload: Record<string, unknown>) {
    if (!id) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.declare(id, payload);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  function onRatify(event: FormEvent) {
    event.preventDefault();
    void runDeclare({ kind: "ratify", binding: true, summary });
  }

  if (error && !view) {
    return <p className="error">{error}</p>;
  }
  if (!view) {
    return <p className="muted">読み込み中…</p>;
  }

  const awaiting = view.thread.state === "awaiting_decision";

  return (
    <article>
      <h1>{view.thread.title}</h1>
      <p className="muted">
        {threadTypeLabel(view.thread.type)} ·{" "}
        {threadStateLabel(view.thread.state)} ·{" "}
        {consensusTypeLabel(view.thread.consensusType)}
      </p>
      <SynthesisCard
        synthesis={view.synthesis}
        candidate={view.candidateProposal}
      />
      <h2>投稿</h2>
      <ol>
        {view.posts.map((post) => (
          <li key={post.id}>
            <strong>{post.authorDisplayName}</strong>{" "}
            <span className="muted">{postTypeLabel(post.type)}</span>
            <p>{post.body}</p>
          </li>
        ))}
      </ol>
      {awaiting ? (
        <form onSubmit={onRatify}>
          <label>
            要約
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              required
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={isDeclaring}>
              批准する
            </button>
            <button
              type="button"
              disabled={isDeclaring}
              onClick={() =>
                void runDeclare({
                  kind: "send_back",
                  reason: reason || "差し戻し",
                })
              }
            >
              差し戻す
            </button>
            <button
              type="button"
              disabled={isDeclaring}
              onClick={() =>
                void runDeclare({
                  kind: "reject_thread",
                  summary: summary || "不採用",
                })
              }
            >
              不採用
            </button>
          </div>
          <label>
            差し戻し理由
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </form>
      ) : null}
      {view.thread.state === "decided" &&
      (view.thread.type === "implementation" || view.thread.type === "review") ? (
        <div className="actions">
          <button
            type="button"
            disabled={isDeclaring}
            onClick={() => void runDeclare({ kind: "complete_thread" })}
          >
            完了にする
          </button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </article>
  );
}

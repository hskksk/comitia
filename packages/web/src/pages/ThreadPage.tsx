import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type HumanThreadView } from "../api.js";
import { PostTypeBadge, ThreadBadges } from "../components/Badges.js";
import { MarkdownBody } from "../components/MarkdownBody.js";
import { SynthesisCard } from "../components/SynthesisCard.js";
import { pullRequestStateLabel } from "../labels.js";
import { formatRelativeTimeJa } from "../relativeTime.js";

export function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<HumanThreadView | null>(null);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeclaring, setIsDeclaring] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    boardClient
      .thread(id)
      .then(setView)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function reloadThread() {
    if (!id) {
      return;
    }
    const next = await boardClient.thread(id);
    setView(next);
  }

  async function runDeclare(payload: Record<string, unknown>) {
    if (!id) {
      return;
    }
    setError(null);
    setIsDeclaring(true);
    try {
      await boardClient.declare(id, payload);
      setRejectConfirmOpen(false);
      await reloadThread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsDeclaring(false);
    }
  }

  function onRatify(event: FormEvent) {
    event.preventDefault();
    if (!summary.trim()) {
      return;
    }
    void runDeclare({ kind: "ratify", binding: true, summary });
  }

  function onSendBack() {
    if (!reason.trim()) {
      return;
    }
    void runDeclare({ kind: "send_back", reason });
  }

  function onRejectClick() {
    if (!summary.trim()) {
      return;
    }
    if (!rejectConfirmOpen) {
      setRejectConfirmOpen(true);
      return;
    }
    void runDeclare({ kind: "reject_thread", summary });
  }

  if (error && !view) {
    return <p className="status status-error">{error}</p>;
  }
  if (!view) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const awaiting = view.thread.state === "awaiting_decision";

  return (
    <article>
      <Link to="/" className="back-link">
        判断キューへ
      </Link>
      <h1>{view.thread.title}</h1>
      <ThreadBadges
        type={view.thread.type}
        state={view.thread.state}
        consensusType={view.thread.consensusType}
      />
      <SynthesisCard
        synthesis={view.synthesis}
        candidate={view.candidateProposal}
      />
      {view.pullRequests.length > 0 ? (
        <>
          <h2>リンク済み PR</h2>
          <ul>
            {view.pullRequests.map((pr) => (
              <li key={pr.number}>
                #{pr.number} {pullRequestStateLabel(pr.state)}{" "}
                <a href={pr.url}>GitHub</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2>投稿</h2>
      <ol className="minutes-list">
        {view.posts.map((post) => (
          <li key={post.id} className="minutes-item">
            <div className="minutes-meta">
              <span className="minutes-author">{post.authorDisplayName}</span>
              <PostTypeBadge type={post.type} />
              <time
                className="muted"
                dateTime={post.createdAt}
                title={post.createdAt}
              >
                {formatRelativeTimeJa(post.createdAt)}
              </time>
            </div>
            <MarkdownBody source={post.body} />
          </li>
        ))}
      </ol>
      {awaiting ? (
        <form className="decision-panel" onSubmit={onRatify}>
          <label>
            要約
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              required
            />
          </label>
          <label>
            差し戻し理由
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={isDeclaring}
            >
              批准する
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isDeclaring || !reason.trim()}
              onClick={onSendBack}
            >
              差し戻す
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={isDeclaring || !summary.trim()}
              onClick={onRejectClick}
            >
              不採用
            </button>
          </div>
          {rejectConfirmOpen ? (
            <div className="decision-confirm" role="group" aria-label="不採用の確認">
              <p>不採用にする。このスレッドは閉じる</p>
              <div className="actions">
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isDeclaring}
                  onClick={onRejectClick}
                >
                  不採用を確定
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isDeclaring}
                  onClick={() => setRejectConfirmOpen(false)}
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}
      {view.thread.state === "decided" &&
      (view.thread.type === "implementation" || view.thread.type === "review") ? (
        <div className="actions">
          <button
            type="button"
            className="btn-primary"
            disabled={isDeclaring}
            onClick={() => void runDeclare({ kind: "complete_thread" })}
          >
            完了にする
          </button>
        </div>
      ) : null}
      {error ? <p className="status status-error">{error}</p> : null}
    </article>
  );
}

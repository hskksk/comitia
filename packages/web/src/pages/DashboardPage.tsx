import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type EventItem, type ProjectSummary } from "../api.js";
import { CollapsibleMarkdown } from "../components/CollapsibleMarkdown.js";
import { judgmentNeedLabel, threadStateLabel } from "../labels.js";
import { projectPath } from "../projectContext.js";
import { formatRelativeTimeJa } from "../relativeTime.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";

function eventKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    thread_created: "スレッド作成",
    post_added: "投稿",
    thread_declaration: "宣言",
    agreement_recorded: "合意",
    project_membership_added: "メンバー追加",
    project_membership_removed: "メンバー削除",
    thread_archived: "スレッド削除",
    proposal_archived: "提案削除",
    project_created: "プロジェクト作成",
    participant_registered: "参加者登録",
  };
  return labels[kind] ?? kind;
}

export function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSummary(null);
    setEvents(null);
    setError(null);
  }, []);

  const load = useCallback(() => {
    if (!projectId) {
      return;
    }
    Promise.all([boardClient.getProject(projectId), boardClient.events(8)])
      .then(([project, eventRes]) => {
        setSummary(project);
        setEvents(eventRes.items);
      })
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

  useRouteLoad(load, [projectId], reset);
  useFocusPoll(load, 15_000);

  if (!projectId) {
    return null;
  }
  if (error && !summary) {
    return <p className="status status-error">{error}</p>;
  }
  if (!summary) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const queuePrimary = summary.queueCount >= 1;
  const threadTotal = Object.values(summary.threadCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <section className="dashboard">
      <h1>{summary.name}</h1>
      {summary.setup &&
      (!summary.setup.projectRule || !summary.setup.threadTemplate) ? (
        <div className="setup-banner">
          <strong>先に場の型を決めてください</strong>
          <p className="muted">
            {!summary.setup.projectRule ? "プロジェクトルール" : null}
            {!summary.setup.projectRule && !summary.setup.threadTemplate
              ? "と"
              : null}
            {!summary.setup.threadTemplate ? "スレッドテンプレ" : null}
            がまだありません。これら以外の提案はできません。
          </p>
          <p>
            <Link to={projectPath(projectId, "threads/new")}>
              ルール / テンプレを提案する
            </Link>
          </p>
        </div>
      ) : null}
      {summary.activeProjectRule ? (
        <section className="project-rules-hero" aria-labelledby="project-rules-heading">
          <div className="project-rules-hero-header">
            <h2 id="project-rules-heading">プロジェクトルール</h2>
            <Link
              to={projectPath(
                projectId,
                `threads/${summary.activeProjectRule.threadId}`,
              )}
              className="project-rules-hero-link muted"
            >
              スレッドへ
            </Link>
          </div>
          <CollapsibleMarkdown
            source={summary.activeProjectRule.content}
            previewLines={5}
            className="project-rules-hero-body"
          />
        </section>
      ) : null}
      <p className="muted">
        {summary.repoUrl ? (
          <a href={summary.repoUrl} target="_blank" rel="noreferrer">
            {summary.repoUrl}
          </a>
        ) : (
          "リポジトリなし"
        )}
      </p>

      <div className="dashboard-grid">
        <article className={`dashboard-card${queuePrimary ? " is-primary" : ""}`}>
          <h2>
            <Link to={projectPath(projectId, "queue")}>判断キュー</Link>
          </h2>
          <p className="dashboard-stat">{summary.queueCount} 件</p>
          {summary.queueCount === 0 ? (
            <p>
              <Link to={projectPath(projectId, "threads/new")}>
                提案する / 作業する
              </Link>
            </p>
          ) : (
            <ul className="dashboard-preview">
              {summary.queuePreview.map((item) => (
                <li key={item.threadId}>
                  <Link to={projectPath(projectId, `threads/${item.threadId}`)}>
                    {item.title}
                  </Link>
                  <span className="muted">
                    {" "}
                    · {judgmentNeedLabel(item.consensusType)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="dashboard-card">
          <h2>
            <Link to={projectPath(projectId, "inbox")}>非ブロッキング</Link>
          </h2>
          <p className="dashboard-stat">{summary.inboxCount} 件</p>
        </article>

        <article className="dashboard-card">
          <h2>
            <Link to={projectPath(projectId, "threads")}>スレッド</Link>
          </h2>
          <p className="dashboard-stat">{threadTotal} 件</p>
          <ul className="dashboard-stats-list muted">
            <li>
              {threadStateLabel("discussing")} {summary.threadCounts.discussing}
            </li>
            <li>
              {threadStateLabel("awaiting_decision")}{" "}
              {summary.threadCounts.awaiting_decision}
            </li>
            <li>
              {threadStateLabel("decided")} {summary.threadCounts.decided}
            </li>
            <li>
              {threadStateLabel("rejected")} {summary.threadCounts.rejected}
            </li>
            <li>
              {threadStateLabel("completed")} {summary.threadCounts.completed}
            </li>
          </ul>
        </article>

        {summary.participantStats ? (
          <article className="dashboard-card">
            <h2>
              <Link to={projectPath(projectId, "participants")}>参加者</Link>
            </h2>
            <ul className="dashboard-stats-list muted">
              <li>人間 {summary.participantStats.humans}</li>
              <li>エージェント接続中 {summary.participantStats.agentsConnected}</li>
              <li>エージェント切断 {summary.participantStats.agentsDisconnected}</li>
            </ul>
          </article>
        ) : null}
      </div>

      {events && events.length > 0 ? (
        <section className="dashboard-events">
          <h2>直近の出来事</h2>
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id} className="event-item">
                <span className="event-kind">{eventKindLabel(event.kind)}</span>
                {event.actorDisplayName ? (
                  <span className="muted event-actor">
                    by {event.actorDisplayName}
                  </span>
                ) : null}
                {event.targetDisplayName ? (
                  <span className="muted event-target">
                    → 対象: {event.targetDisplayName}
                  </span>
                ) : null}
                <time className="muted" dateTime={event.createdAt}>
                  {formatRelativeTimeJa(event.createdAt)}
                </time>
                {event.threadId ? (
                  <Link
                    to={projectPath(projectId, `threads/${event.threadId}`)}
                    className="event-thread"
                  >
                    スレッドへ
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <p className="status status-error">{error}</p> : null}
    </section>
  );
}

import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  boardClient,
  type ActivityItem,
  type ProjectSummary,
} from "../api.js";
import { ActivityList } from "../components/ActivityList.js";
import { CollapsibleMarkdown } from "../components/CollapsibleMarkdown.js";
import { judgmentNeedLabel, threadStateLabel } from "../labels.js";
import { projectPath } from "../projectContext.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";

export function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [activities, setActivities] = useState<ActivityItem[] | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSummary(null);
    setActivities(null);
    setSummaryError(null);
    setActivityError(null);
  }, []);

  const loadActivity = useCallback(() => {
    if (!projectId) {
      return;
    }
    boardClient
      .activity(12)
      .then((response) => {
        setActivities(response.items);
        setActivityError(null);
      })
      .catch((err: Error) => setActivityError(err.message));
  }, [projectId]);

  const load = useCallback(() => {
    if (!projectId) {
      return;
    }
    boardClient
      .getProject(projectId)
      .then((project) => {
        setSummary(project);
        setSummaryError(null);
      })
      .catch((err: Error) => setSummaryError(err.message));
    loadActivity();
  }, [loadActivity, projectId]);

  useRouteLoad(load, [projectId], reset);
  useFocusPoll(load, 15_000);

  if (!projectId) {
    return null;
  }
  if (summaryError && !summary) {
    return <p className="status status-error">{summaryError}</p>;
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

      <section className="dashboard-activity" aria-labelledby="activity-heading">
        <h2 id="activity-heading">最近の活動</h2>
        {activityError ? (
          <div className="activity-error">
            <p className="status status-error">
              活動を読み込めませんでした: {activityError}
            </p>
            <button type="button" onClick={loadActivity}>
              再取得
            </button>
          </div>
        ) : activities === null ? (
          <p className="status status-loading">活動を読み込み中…</p>
        ) : activities.length === 0 ? (
          <p className="muted">まだ活動はありません</p>
        ) : (
          <ActivityList items={activities} />
        )}
      </section>

      {summaryError ? (
        <p className="status status-error">{summaryError}</p>
      ) : null}
    </section>
  );
}

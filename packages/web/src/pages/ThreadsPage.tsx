import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type ThreadListItem } from "../api.js";
import { ThreadBadges } from "../components/Badges.js";
import { projectPath } from "../projectContext.js";
import { formatRelativeTimeJa } from "../relativeTime.js";
import {
  DEFAULT_THREAD_LIST_SORT,
  visibleThreadListItems,
  type ThreadListFilter,
  type ThreadListSort,
} from "../threadListView.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";

export function ThreadsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [items, setItems] = useState<ThreadListItem[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadListFilter>("all");
  const [sort, setSort] = useState<ThreadListSort>(DEFAULT_THREAD_LIST_SORT);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setItems(null);
    setMeId(null);
    setError(null);
  }, []);

  const load = useCallback(() => {
    Promise.all([boardClient.threads(), boardClient.me()])
      .then(([res, me]) => {
        setItems(res.items);
        setMeId(me.participant.id);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useRouteLoad(load, [projectId], reset);
  useFocusPoll(load, 15_000);

  if (!projectId) {
    return null;
  }
  if (error) {
    return <p className="status status-error">{error}</p>;
  }
  if (!items) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const visible = visibleThreadListItems(items, {
    filter,
    sort,
    hideCompleted,
    meId,
  });
  const hiddenCompletedCount = hideCompleted
    ? items.filter((item) => item.state === "completed").length
    : 0;

  return (
    <section>
      <div className="page-toolbar">
        <h1>スレッド</h1>
        <div className="actions">
          <Link to={projectPath(projectId, "threads/new")} className="btn-primary">
            提案する / 作業する
          </Link>
        </div>
      </div>
      <div className="filter-row">
        {(
          [
            ["all", "すべて"],
            ["mine", "自分がオーナー"],
            ["proposal", "提案"],
            ["implementation", "実装"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "btn-primary" : "btn-secondary"}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <label className="filter-control">
          表示順
          <select
            aria-label="表示順"
            value={sort}
            onChange={(event) => setSort(event.target.value as ThreadListSort)}
          >
            <option value="latest_event">最新の動き</option>
            <option value="created_at">作成が新しい順</option>
            <option value="title">タイトル順</option>
          </select>
        </label>
        <button
          type="button"
          aria-pressed={hideCompleted}
          className={hideCompleted ? "btn-primary" : "btn-secondary"}
          onClick={() => setHideCompleted(true)}
        >
          完了を除く
        </button>
        <button
          type="button"
          aria-pressed={!hideCompleted}
          className={!hideCompleted ? "btn-primary" : "btn-secondary"}
          onClick={() => setHideCompleted(false)}
        >
          完了も表示
        </button>
      </div>
      {hiddenCompletedCount > 0 ? (
        <p className="muted">完了したスレッドは非表示です。</p>
      ) : null}
      {items.length === 0 ? (
        <p className="status status-empty">
          スレッドはまだありません。
          <Link to={projectPath(projectId, "threads/new")}>
            提案する / 作業する
          </Link>
        </p>
      ) : visible.length === 0 ? (
        <p className="status status-empty">該当するスレッドはありません。</p>
      ) : (
        visible.map((item) => (
          <article key={item.id} className="card">
            <h2>
              <Link to={projectPath(projectId, `threads/${item.id}`)}>
                {item.title}
              </Link>
            </h2>
            <ThreadBadges
              type={item.type}
              state={item.state}
              consensusType={item.consensusType}
              activeWorkClaimants={item.activeWorkClaimants}
            />
            <p className="muted">
              <time
                dateTime={item.lastEventAt ?? item.createdAt}
                title={item.lastEventAt ?? item.createdAt}
              >
                最終 {formatRelativeTimeJa(item.lastEventAt ?? item.createdAt)}
              </time>
            </p>
          </article>
        ))
      )}
    </section>
  );
}

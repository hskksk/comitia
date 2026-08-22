import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type ThreadListItem } from "../api.js";
import { ThreadBadges } from "../components/Badges.js";
import { projectPath } from "../projectContext.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";

type Filter = "all" | "mine" | "proposal" | "implementation";

export function ThreadsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [items, setItems] = useState<ThreadListItem[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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

  const visible = items.filter((item) => {
    if (filter === "mine") {
      return meId !== null && item.ownerParticipantId === meId;
    }
    if (filter === "proposal" || filter === "implementation") {
      return item.type === filter;
    }
    return true;
  });

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
      {visible.length === 0 ? (
        <p className="status status-empty">
          スレッドはまだありません。
          <Link to={projectPath(projectId, "threads/new")}>
            提案する / 作業する
          </Link>
        </p>
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
          </article>
        ))
      )}
    </section>
  );
}

import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type SessionItem } from "../api.js";
import { projectPath } from "../projectContext.js";
import { useRouteLoad } from "../useRouteLoad.js";

export function AgentSessionsPage() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>();
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setItems(null);
    setError(null);
  }, []);

  const load = useCallback(() => {
    if (!id) {
      return;
    }
    boardClient
      .agentSessions(id)
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useRouteLoad(load, [id, projectId], reset);

  if (!projectId) {
    return null;
  }
  if (error) {
    return <p className="status status-error">{error}</p>;
  }
  if (!items) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  return (
    <section>
      <Link to={projectPath(projectId, "participants")} className="back-link">
        参加者へ
      </Link>
      <h1>セッション</h1>
      {items.length === 0 ? (
        <p className="status status-empty">セッションはまだありません</p>
      ) : (
        items.map((item) => (
          <article key={item.id} className="card">
            <h2>
              <Link to={projectPath(projectId, `sessions/${item.id}`)}>
                ログを読む
              </Link>
            </h2>
            <p className="muted">
              {item.endedAt ? "終了" : "開いている"} · 残量 {item.remainingBudget}
              {item.endedReason ? ` · ${item.endedReason}` : ""}
            </p>
            {item.goals[0] ? <p>{item.goals[0].text}</p> : null}
          </article>
        ))
      )}
    </section>
  );
}

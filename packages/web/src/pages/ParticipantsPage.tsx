import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boardClient, type ParticipantItem } from "../api.js";
import { useFocusPoll } from "../useFocusPoll.js";

function connectionLabel(status: "connected" | "disconnected" | "never"): string {
  if (status === "connected") {
    return "接続中";
  }
  if (status === "disconnected") {
    return "切断";
  }
  return "未接続";
}

export function ParticipantsPage() {
  const [items, setItems] = useState<ParticipantItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    boardClient
      .participants()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);
  useFocusPoll(load, 15_000);

  async function onWake(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await boardClient.wakeAgent(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "起床に失敗しました");
    } finally {
      setBusyId(null);
    }
  }

  if (error && !items) {
    return <p className="status status-error">{error}</p>;
  }
  if (!items) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  return (
    <section>
      <h1>参加者</h1>
      {error ? <p className="status status-error">{error}</p> : null}
      {items.map((item) => (
        <article key={item.id} className="card">
          <h2>{item.displayName}</h2>
          <p className="muted">
            {item.kind === "agent" ? "エージェント" : "人間"}
            {item.engine ? ` · ${item.engine}` : ""}
            {item.roles.length > 0 ? ` · ${item.roles.join("、")}` : ""}
          </p>
          {item.connection ? (
            <p>
              <span className={`connection-badge is-${item.connection.status}`}>
                {connectionLabel(item.connection.status)}
              </span>
            </p>
          ) : null}
          {item.openSession ? (
            <p className="muted">
              開いているセッション 残量 {item.openSession.remainingBudget}
              {item.openSession.firstGoal
                ? ` · ${item.openSession.firstGoal}`
                : ""}
            </p>
          ) : null}
          {item.kind === "agent" ? (
            <div className="actions">
              <Link to={`/participants/${item.id}`} className="btn-secondary">
                ログ
              </Link>
              <button
                type="button"
                className="btn-primary"
                disabled={busyId === item.id}
                onClick={() => void onWake(item.id)}
              >
                起こす
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

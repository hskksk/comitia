import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boardClient, type MeResponse, type ParticipantItem } from "../api.js";
import { engineLabel } from "../labels.js";
import { projectPath } from "../projectContext.js";
import { useFocusPoll } from "../useFocusPoll.js";
import { useRouteLoad } from "../useRouteLoad.js";

function connectionLabel(status: "connected" | "disconnected" | "never"): string {
  if (status === "connected") {
    return "接続中";
  }
  if (status === "disconnected") {
    return "切断";
  }
  return "未接続";
}

function wakeLabel(wake: "undigested" | "queued" | "idle"): string {
  if (wake === "undigested") {
    return "起床待ち（未消化）";
  }
  if (wake === "queued") {
    return "起床待ち（未接続）";
  }
  return "休眠";
}

export function ParticipantsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [items, setItems] = useState<ParticipantItem[] | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setItems(null);
    setMe(null);
    setError(null);
  }, []);

  const load = useCallback(() => {
    boardClient
      .participants()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
    boardClient
      .me()
      .then((res) => setMe(res))
      .catch(() => undefined);
  }, []);

  useRouteLoad(load, [projectId], reset);
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

  if (!projectId) {
    return null;
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
          <h2>{item.label ?? item.displayName}</h2>
          <p className="muted">
            {item.kind === "agent" ? "エージェント" : "人間"}
            {item.engine ? ` · ${engineLabel(item.engine)}` : ""}
            {item.roles.length > 0 ? ` · ${item.roles.join("、")}` : ""}
          </p>
          {item.kind === "agent" && item.personality ? (
            <p className="muted">態度: {item.personality}</p>
          ) : null}
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
          {item.wake ? (
            <p>
              <span className={`wake-badge is-${item.wake}`}>
                {wakeLabel(item.wake)}
              </span>
            </p>
          ) : null}
          {item.kind === "agent" || item.id === me?.participant.id ? (
            <div className="actions">
              {item.kind === "agent" ? (
                <>
                  <Link
                    to={projectPath(projectId, `participants/${item.id}`)}
                    className="btn-secondary"
                  >
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
                </>
              ) : null}
              {item.id === me?.participant.id ? (
                <Link to={projectPath(projectId, "notes")} className="btn-secondary">
                  自分のメモ
                </Link>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

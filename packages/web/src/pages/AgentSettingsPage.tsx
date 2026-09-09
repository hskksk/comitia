import { type FormEvent, useCallback, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ENGINES } from "@comitia/shared";
import { boardClient, type OwnedAgent } from "../api.js";
import { engineLabel } from "../labels.js";
import { PersonalityField } from "../PersonalityField.js";
import { useRouteLoad } from "../useRouteLoad.js";

export function AgentSettingsPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [agent, setAgent] = useState<OwnedAgent | null | undefined>(undefined);
  const [displayName, setDisplayName] = useState("");
  const [engine, setEngine] = useState("claude-code");
  const [personality, setPersonality] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setAgent(undefined);
    setError(null);
  }, []);

  const reload = useCallback(() => {
    if (!agentId) {
      return;
    }
    return boardClient
      .listOwnedAgents()
      .then((res) => {
        const found = res.items.find((item) => item.id === agentId) ?? null;
        setAgent(found);
        if (found) {
          setDisplayName(found.displayName);
          setEngine(found.engine);
          setPersonality(found.personality ?? "");
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [agentId]);

  useRouteLoad(reload, [agentId], reset);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!agentId || !displayName.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await boardClient.updateOwnedAgent(agentId, {
        displayName: displayName.trim(),
        engine,
        personality: personality.trim() ? personality.trim() : null,
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (error && agent === undefined) {
    return <p className="status status-error">{error}</p>;
  }
  if (agent === undefined) {
    return <p className="status status-loading">読み込み中…</p>;
  }
  if (!agent) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <section>
      <p className="muted">
        <Link to="/settings">ユーザー設定</Link>
      </p>
      <h1>エージェント設定</h1>
      <p className="muted">
        agentId: <code>{agent.id}</code>
      </p>
      <form className="composer" onSubmit={(event) => void onSave(event)}>
        <label>
          表示名
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
        <label>
          エンジン
          <select
            value={engine}
            onChange={(event) => setEngine(event.target.value)}
          >
            {ENGINES.map((item) => (
              <option key={item} value={item}>
                {engineLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <PersonalityField value={personality} onChange={setPersonality} />
        <div className="actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            保存する
          </button>
        </div>
      </form>
      {error ? <p className="status status-error">{error}</p> : null}
    </section>
  );
}

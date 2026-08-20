import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  boardClient,
  type MeResponse,
  type OwnedAgent,
  type ProjectListItem,
} from "../api.js";
import { engineLabel } from "../labels.js";

export function SettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [agents, setAgents] = useState<OwnedAgent[] | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEngine, setNewAgentEngine] = useState("claude-code");
  const [newAgentProjectId, setNewAgentProjectId] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const tokenRevealRef = useRef<HTMLDivElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEngine, setEditEngine] = useState("claude-code");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function reloadAgents() {
    return boardClient
      .listOwnedAgents()
      .then((res) => setAgents(res.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    Promise.all([boardClient.me(), boardClient.listProjects(), reloadAgents()])
      .then(([identity, projectRes]) => {
        setMe(identity);
        setDisplayName(identity.participant.displayName);
        setProjects(projectRes.items);
        if (projectRes.items[0]) {
          setNewAgentProjectId(projectRes.items[0].id);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSaveProfile(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await boardClient.patchMe({
        displayName: displayName.trim(),
      });
      setMe((prev) =>
        prev
          ? {
              ...prev,
              participant: { ...prev.participant, displayName: updated.participant.displayName },
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function onCreateAgent(event: FormEvent) {
    event.preventDefault();
    if (!newAgentName.trim() || !newAgentProjectId) {
      return;
    }
    setSaving(true);
    setError(null);
    setCreatedToken(null);
    try {
      const result = await boardClient.createAgent({
        displayName: newAgentName.trim(),
        engine: newAgentEngine,
        projectId: newAgentProjectId,
        role: newAgentRole || undefined,
      });
      setCreatedToken(result.agentToken);
      setNewAgentName("");
      setNewAgentRole("");
      await reloadAgents();
      requestAnimationFrame(() => {
        const element = tokenRevealRef.current;
        if (typeof element?.scrollIntoView === "function") {
          element.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveAgent(agentId: string) {
    setSaving(true);
    setError(null);
    try {
      await boardClient.updateOwnedAgent(agentId, {
        displayName: editName.trim() || undefined,
        engine: editEngine,
      });
      setEditingId(null);
      await reloadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteAgent(agentId: string) {
    setSaving(true);
    setError(null);
    try {
      await boardClient.archiveOwnedAgent(agentId);
      setDeleteConfirmId(null);
      await reloadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (error && !me) {
    return <p className="status status-error">{error}</p>;
  }
  if (!me) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  const githubLinked = Boolean(me.participant.githubLogin);

  return (
    <section>
      <h1>ユーザー設定</h1>

      <form className="composer" onSubmit={onSaveProfile}>
        <h2>プロフィール</h2>
        <label>
          表示名
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={saving}>
          保存する
        </button>
      </form>

      <section className="composer">
        <h2>GitHub</h2>
        {githubLinked ? (
          <p className="muted">連携済み: {me.participant.githubLogin}</p>
        ) : (
          <p className="muted">
            GitHub 連携はログイン画面の「GitHub で入る」から行えます。
          </p>
        )}
      </section>

      <section className="composer">
        <h2>登録したエージェント</h2>
        {createdToken ? (
          <div className="token-reveal" role="status" ref={tokenRevealRef}>
            <p>
              <strong>トークン（一度だけ表示）</strong>
            </p>
            <code>{createdToken}</code>
            <p className="muted">コピーして comitia 側へ渡してください。</p>
          </div>
        ) : null}
        {agents === null ? (
          <p className="muted">読み込み中…</p>
        ) : agents.length === 0 ? (
          <p className="muted">まだエージェントはありません</p>
        ) : (
          <ul className="agent-settings-list">
            {agents.map((agent) => (
              <li key={agent.id} className="agent-settings-item">
                {editingId === agent.id ? (
                  <div>
                    <label>
                      表示名
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                      />
                    </label>
                    <label>
                      エンジン
                      <select
                        value={editEngine}
                        onChange={(event) => setEditEngine(event.target.value)}
                      >
                        <option value="claude-code">claude-code</option>
                        <option value="fake">fake</option>
                      </select>
                    </label>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={saving}
                        onClick={() => void onSaveAgent(agent.id)}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setEditingId(null)}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p>
                      <strong>{agent.displayName}</strong>{" "}
                      <span className="muted">· {engineLabel(agent.engine)}</span>
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setEditingId(agent.id);
                          setEditName(agent.displayName);
                          setEditEngine(agent.engine);
                        }}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => setDeleteConfirmId(agent.id)}
                      >
                        削除
                      </button>
                    </div>
                    {deleteConfirmId === agent.id ? (
                      <div className="decision-confirm" role="group">
                        <p>このエージェントを削除します。資格は無効になります。</p>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={saving}
                            onClick={() => void onDeleteAgent(agent.id)}
                          >
                            削除を確定
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <form className="composer" onSubmit={onCreateAgent}>
          <h3>エージェントを追加</h3>
          <label>
            名前
            <input
              value={newAgentName}
              onChange={(event) => setNewAgentName(event.target.value)}
              required
            />
          </label>
          <label>
            エンジン
            <select
              value={newAgentEngine}
              onChange={(event) => setNewAgentEngine(event.target.value)}
            >
              <option value="claude-code">claude-code</option>
              <option value="fake">fake</option>
            </select>
          </label>
          <label>
            プロジェクト
            <select
              value={newAgentProjectId}
              onChange={(event) => setNewAgentProjectId(event.target.value)}
              required
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            ロール（任意）
            <select
              value={newAgentRole}
              onChange={(event) => setNewAgentRole(event.target.value)}
            >
              <option value="">なし</option>
              <option value="facilitator">facilitator</option>
              <option value="proposer">proposer</option>
              <option value="reviewer">reviewer</option>
              <option value="recorder">recorder</option>
              <option value="executor">executor</option>
            </select>
          </label>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || projects.length === 0}
          >
            登録する
          </button>
        </form>
      </section>

      {error ? <p className="status status-error">{error}</p> : null}
    </section>
  );
}

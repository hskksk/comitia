import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boardClient, type ProjectListItem } from "../api.js";
import { projectPath, saveLastProjectId } from "../projectContext.js";

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newRepoUrl, setNewRepoUrl] = useState("");
  const [joinToken, setJoinToken] = useState("");

  function reload() {
    return boardClient
      .listProjects()
      .then((res) => setProjects(res.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    reload();
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await boardClient.createProject({
        name: newName.trim(),
        repoUrl: newRepoUrl.trim() || undefined,
      });
      saveLastProjectId(created.id);
      navigate(projectPath(created.id), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function onJoin(event: FormEvent) {
    event.preventDefault();
    if (!joinToken.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const joined = await boardClient.join(joinToken.trim());
      saveLastProjectId(joined.id);
      navigate(projectPath(joined.id), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "参加に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function openProject(id: string) {
    saveLastProjectId(id);
    navigate(projectPath(id));
  }

  if (error && !projects) {
    return <p className="status status-error">{error}</p>;
  }
  if (!projects) {
    return <p className="status status-loading">読み込み中…</p>;
  }

  return (
    <section className="projects-page">
      <h1>プロジェクト</h1>

      {projects.length > 0 ? (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="project-list-item"
                onClick={() => openProject(project.id)}
              >
                <strong>{project.name}</strong>
                {project.repoUrl ? (
                  <span className="muted"> · {project.repoUrl}</span>
                ) : (
                  <span className="muted"> · リポジトリなし</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="status status-empty">所属しているプロジェクトはありません</p>
      )}

      <form className="composer" onSubmit={onCreate}>
        <h2>新しいプロジェクト</h2>
        <label>
          名前
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            required
          />
        </label>
        <label>
          リポジトリ URL（任意）
          <input
            value={newRepoUrl}
            onChange={(event) => setNewRepoUrl(event.target.value)}
            placeholder="https://github.com/org/repo"
          />
        </label>
        <button type="submit" className="btn-primary" disabled={saving}>
          作成する
        </button>
      </form>

      <form className="composer" onSubmit={onJoin}>
        <h2>招待で参加</h2>
        <label>
          招待トークン
          <input
            value={joinToken}
            onChange={(event) => setJoinToken(event.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn-secondary" disabled={saving}>
          参加する
        </button>
      </form>

      {error ? <p className="status status-error">{error}</p> : null}
    </section>
  );
}

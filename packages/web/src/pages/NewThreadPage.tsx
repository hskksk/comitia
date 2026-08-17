import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { boardClient, type AgreementItem, type SearchThreadItem } from "../api.js";

export function NewThreadPage() {
  const navigate = useNavigate();
  const [type, setType] = useState<"proposal" | "implementation">("proposal");
  const [title, setTitle] = useState("");
  const [trigger, setTrigger] = useState("");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<"shared_artifact" | "repo_artifact">(
    "shared_artifact",
  );
  const [sharedArtifactKind, setSharedArtifactKind] = useState("project_rule");
  const [conflictChecked, setConflictChecked] = useState(false);
  const [searched, setSearched] = useState(false);
  const [duplicates, setDuplicates] = useState<SearchThreadItem[]>([]);
  const [decisions, setDecisions] = useState<AgreementItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const [threads, agreements] = await Promise.all([
        boardClient.searchThreads(query),
        boardClient.searchDecisions(query),
      ]);
      setDuplicates(threads.items);
      setDecisions(agreements.items);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "検索に失敗しました");
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!searched || !title.trim() || !trigger.trim() || !query.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await boardClient.createThread({
        title: title.trim(),
        type,
        trigger: trigger.trim(),
        duplicateSearchQuery: query.trim(),
        conflictCitationsChecked: conflictChecked || decisions.length === 0,
        consensusType:
          type === "proposal" ? "human_ratification" : "owner_decision",
        ...(type === "proposal"
          ? {
              target,
              sharedArtifactKind:
                target === "shared_artifact" ? sharedArtifactKind : undefined,
            }
          : {}),
      });
      navigate(`/threads/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article>
      <Link to="/threads" className="back-link">
        スレッド一覧へ
      </Link>
      <h1>{type === "proposal" ? "提案する" : "作業する"}</h1>
      <div className="actions">
        <button
          type="button"
          className={type === "proposal" ? "btn-primary" : "btn-secondary"}
          onClick={() => setType("proposal")}
        >
          提案スレッド
        </button>
        <button
          type="button"
          className={type === "implementation" ? "btn-primary" : "btn-secondary"}
          onClick={() => setType("implementation")}
        >
          実装スレッド
        </button>
      </div>
      <form className="composer" onSubmit={onSearch}>
        <label>
          重複検索
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearched(false);
            }}
            required
          />
        </label>
        <button type="submit" className="btn-secondary">
          重複を検索
        </button>
      </form>
      {searched ? (
        <section className="search-results">
          <h2>既存スレッド</h2>
          {duplicates.length === 0 ? (
            <p className="muted">該当なし</p>
          ) : (
            <ul>
              {duplicates.map((item) => (
                <li key={item.id}>
                  <Link to={`/threads/${item.id}`}>{item.title}</Link>
                </li>
              ))}
            </ul>
          )}
          <h2>既存の決定</h2>
          {decisions.length === 0 ? (
            <p className="muted">該当なし</p>
          ) : (
            <ul>
              {decisions.map((item) => (
                <li key={item.id}>{item.summary}</li>
              ))}
            </ul>
          )}
          <label>
            <input
              type="checkbox"
              checked={conflictChecked}
              onChange={(event) => setConflictChecked(event.target.checked)}
            />
            衝突する決定を確認した
          </label>
        </section>
      ) : null}
      <form className="composer" onSubmit={onCreate}>
        <label>
          タイトル
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <label>
          きっかけ
          <textarea
            value={trigger}
            onChange={(event) => setTrigger(event.target.value)}
            required
          />
        </label>
        {type === "proposal" ? (
          <>
            <label>
              対象
              <select
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as "shared_artifact" | "repo_artifact")
                }
              >
                <option value="shared_artifact">共有物</option>
                <option value="repo_artifact">リポジトリの具体物</option>
              </select>
            </label>
            {target === "shared_artifact" ? (
              <label>
                共有物の種類
                <select
                  value={sharedArtifactKind}
                  onChange={(event) => setSharedArtifactKind(event.target.value)}
                >
                  <option value="project_rule">プロジェクトルール</option>
                  <option value="thread_template">スレッドテンプレ</option>
                  <option value="skill">スキル</option>
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        <button
          type="submit"
          className="btn-primary"
          disabled={!searched || saving}
        >
          スレッドを立てる
        </button>
      </form>
      {error ? <p className="status status-error">{error}</p> : null}
    </article>
  );
}

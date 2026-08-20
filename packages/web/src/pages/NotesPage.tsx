import { type FormEvent, useEffect, useState } from "react";
import { boardClient, type MemoryItem, type NoteItem } from "../api.js";
import { MarkdownBody } from "../components/MarkdownBody.js";

export function NotesPage() {
  const [memory, setMemory] = useState<MemoryItem[] | null>(null);
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");

  function loadMemory() {
    boardClient
      .memory()
      .then((res) => setMemory(res.items))
      .catch((err: Error) => setError(err.message));
  }

  function loadNotes(q?: string) {
    boardClient
      .notes(q)
      .then((res) => setNotes(res.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    loadMemory();
    loadNotes();
  }, []);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    loadNotes(query.trim() || undefined);
  }

  async function onWriteNote(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await boardClient.writeNote({ title, body, format: "journal", visibility });
      setTitle("");
      setBody("");
      loadNotes(query.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section>
      <h1>自分のメモ</h1>
      {error ? <p className="status status-error">{error}</p> : null}

      <h2>個別記憶</h2>
      {memory === null ? (
        <p className="status status-loading">読み込み中…</p>
      ) : memory.length === 0 ? (
        <p className="status status-empty">記憶はまだありません</p>
      ) : (
        <ul>
          {memory.map((m) => (
            <li key={m.id}>{m.body}</li>
          ))}
        </ul>
      )}

      <h2>公開メモを探す</h2>
      <form className="composer" onSubmit={onSearch}>
        <label>
          検索語
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit" className="btn-secondary">
          探す
        </button>
      </form>
      {notes === null ? (
        <p className="status status-loading">読み込み中…</p>
      ) : notes.length === 0 ? (
        <p className="status status-empty">メモはまだありません</p>
      ) : (
        notes.map((note) => (
          <article key={note.id} className="card">
            <h3>
              {note.title}{" "}
              <span className="muted">
                {note.visibility === "public" ? "公開" : "非公開"}
              </span>
            </h3>
            <MarkdownBody source={note.body} />
          </article>
        ))
      )}

      <h2>メモを書く</h2>
      <form className="composer" onSubmit={onWriteNote}>
        <label>
          見出し
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <label>
          本文
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
          />
        </label>
        <label>
          公開範囲
          <select
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as "public" | "private")
            }
          >
            <option value="public">公開</option>
            <option value="private">非公開</option>
          </select>
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={isSaving || !title.trim() || !body.trim()}
        >
          保存する
        </button>
      </form>
    </section>
  );
}

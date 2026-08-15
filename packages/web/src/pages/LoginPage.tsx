import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boardClient } from "../api.js";
import { setToken } from "../auth.js";

export function LoginPage() {
  const navigate = useNavigate();
  const [token, setTokenField] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToken(token.trim());
    try {
      await boardClient.me();
      navigate("/", { replace: true });
    } catch {
      setToken("");
      setError("トークンが無効です。comitia init の ownerToken を貼ってください。");
    }
  }

  return (
    <main className="layout">
      <h1>Comitia</h1>
      <p className="muted">プロジェクトオーナーのトークンで入る</p>
      <form onSubmit={onSubmit}>
        <label>
          オーナートークン
          <input
            value={token}
            onChange={(e) => setTokenField(e.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <div className="actions">
          <button type="submit">入る</button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </main>
  );
}

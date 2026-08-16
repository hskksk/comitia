import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boardClient } from "../api.js";
import { clearToken, setToken } from "../auth.js";

export function LoginPage() {
  const navigate = useNavigate();
  const [token, setTokenField] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [githubOAuth, setGithubOAuth] = useState(false);

  useEffect(() => {
    void boardClient
      .authConfig()
      .then((config) => setGithubOAuth(config.githubOAuth))
      .catch(() => setGithubOAuth(false));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToken(token.trim());
    try {
      await boardClient.me();
      navigate("/", { replace: true });
    } catch {
      clearToken();
      setError("トークンが無効です。comitia init の ownerToken を貼ってください。");
    }
  }

  return (
    <main className="layout">
      <h1>Comitia</h1>
      {githubOAuth ? (
        <p>
          <a href="/v1/auth/github">GitHub で入る</a>
        </p>
      ) : null}
      <details>
        <summary>トークンで入る</summary>
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
      </details>
    </main>
  );
}

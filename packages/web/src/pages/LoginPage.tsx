import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boardClient } from "../api.js";
import { clearToken, setToken } from "../auth.js";
import { resolvePostLoginPath } from "../projectContext.js";

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
      const me = await boardClient.me();
      navigate(resolvePostLoginPath(me), { replace: true });
    } catch {
      clearToken();
      setError("トークンが無効です。comitia init のトークンを貼ってください。");
    }
  }

  return (
    <main className="layout login-panel">
      <h1>Comitia</h1>
      {githubOAuth ? (
        <p>
          <a
            className="back-link"
            href={`/v1/auth/github?return_origin=${encodeURIComponent(window.location.origin)}`}
          >
            GitHub で入る
          </a>
        </p>
      ) : null}
      <details>
        <summary>トークンで入る</summary>
        <p className="muted">人間またはオーナーのトークンで入る</p>
        <form onSubmit={onSubmit}>
          <label>
            トークン
            <input
              type="text"
              value={token}
              onChange={(e) => setTokenField(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <div className="actions">
            <button type="submit" className="btn-primary">
              入る
            </button>
          </div>
          {error ? <p className="status status-error">{error}</p> : null}
        </form>
      </details>
    </main>
  );
}

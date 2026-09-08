import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boardClient } from "../api.js";
import { clearToken, setToken } from "../auth.js";
import { resolvePostLoginPath } from "../projectContext.js";

export function LoginPage() {
  const navigate = useNavigate();
  const [token, setTokenField] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"preview" | "token" | "copy" | null>(null);
  const [githubOAuth, setGithubOAuth] = useState(false);
  const [previewLogin, setPreviewLogin] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);

  useEffect(() => {
    void boardClient
      .authConfig()
      .then((config) => {
        setGithubOAuth(config.githubOAuth);
        setPreviewLogin(config.previewLogin);
      })
      .catch(() => {
        setGithubOAuth(false);
        setPreviewLogin(false);
      })
      .finally(() => setConfigLoaded(true));
  }, []);

  async function completeLogin(nextToken: string) {
    setToken(nextToken.trim());
    const me = await boardClient.me();
    navigate(resolvePostLoginPath(me), { replace: true });
  }

  async function onPreviewLogin() {
    setError(null);
    setTokenNotice(null);
    setLoading("preview");
    try {
      const { token: previewToken } = await boardClient.previewLogin();
      await completeLogin(previewToken);
    } catch {
      clearToken();
      setError("プレビュー環境の準備ができていません。しばらく待ってから再度お試しください。");
    } finally {
      setLoading(null);
    }
  }

  async function onCopyPreviewToken() {
    setError(null);
    setTokenNotice(null);
    setLoading("copy");
    try {
      const { token: previewToken } = await boardClient.previewLogin();
      setTokenField(previewToken);
      try {
        await navigator.clipboard.writeText(previewToken);
        setTokenNotice("CLI 用トークンをコピーしました。");
      } catch {
        setTokenNotice("CLI 用トークンを取得しました。下の欄からコピーしてください。");
      }
    } catch {
      setError("プレビュー環境の準備ができていません。しばらく待ってから再度お試しください。");
    } finally {
      setLoading(null);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setTokenNotice(null);
    setLoading("token");
    try {
      await completeLogin(token);
    } catch {
      clearToken();
      setError("トークンが無効です。comitia init のトークンを貼ってください。");
    } finally {
      setLoading(null);
    }
  }

  const showGithub = githubOAuth && !previewLogin;

  return (
    <div className="login-page">
      <main className="login-card">
        <div className="login-brand">
          <p className="login-eyebrow">Consensus board</p>
          <h1>Comitia</h1>
          <p className="login-lead">
            人間と AI が同じ場で合意を作り、具体物を残す。
          </p>
        </div>

        <div className="login-actions">
          {!configLoaded ? (
            <p className="login-note muted">読み込み中…</p>
          ) : null}

          {configLoaded && previewLogin ? (
            <>
              <button
                type="button"
                className="btn-primary login-action-btn"
                onClick={() => void onPreviewLogin()}
                disabled={loading !== null}
              >
                {loading === "preview" ? "入っています…" : "プレビューに入る"}
              </button>
              <p className="login-note muted">
                PR プレビュー用の共有ログインです。本番では使えません。
              </p>
              <button
                type="button"
                className="btn-secondary login-action-btn"
                onClick={() => void onCopyPreviewToken()}
                disabled={loading !== null}
              >
                {loading === "copy" ? "取得中…" : "CLI 用にトークンをコピー"}
              </button>
            </>
          ) : null}

          {configLoaded && showGithub ? (
            <a
              className="btn-primary login-action-btn login-github-btn"
              href={`/v1/auth/github?return_origin=${encodeURIComponent(window.location.origin)}`}
            >
              GitHub で入る
            </a>
          ) : null}

          {configLoaded && !previewLogin && !showGithub ? (
            <p className="login-note muted">
              GitHub OAuth が未設定の環境では、下のトークン入力で入れます。
            </p>
          ) : null}
        </div>

        <details className="login-token-panel">
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
                spellCheck={false}
                required
              />
            </label>
            <div className="actions">
              <button
                type="submit"
                className="btn-secondary"
                disabled={loading !== null}
              >
                {loading === "token" ? "確認中…" : "入る"}
              </button>
            </div>
          </form>
        </details>

        {tokenNotice ? <p className="login-note muted">{tokenNotice}</p> : null}
        {error ? <p className="status status-error login-error">{error}</p> : null}
      </main>
    </div>
  );
}

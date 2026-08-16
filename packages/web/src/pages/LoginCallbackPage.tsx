import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { setToken } from "../auth.js";
import { boardClient } from "../api.js";

export function LoginCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }
    setToken(token);
    void boardClient
      .me()
      .then(() => navigate("/", { replace: true }))
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate, params]);

  return <p className="muted">ログイン処理中…</p>;
}

/**
 * Comitia PR preview: fetch the bootstrap token from the current origin.
 *
 * Use on /login of a Railway PR environment. Requires preview login (see railway.md).
 * Regenerate the draggable bookmark link with:
 *   node scripts/comitia-preview-bookmarklet.mjs
 */
(async () => {
  const origin = location.origin;
  if (!location.pathname.startsWith("/login")) {
    const ok = confirm(
      "Comitia の /login 以外です。このページ（" +
        origin +
        "）でトークンを取得しますか？",
    );
    if (!ok) {
      return;
    }
  }

  try {
    const configRes = await fetch(origin + "/v1/auth/config");
    if (!configRes.ok) {
      throw new Error("auth config " + configRes.status);
    }
    const config = await configRes.json();
    if (!config.previewLogin) {
      alert(
        "この環境はプレビューログイン非対応です（production / staging 等）。",
      );
      return;
    }

    const loginRes = await fetch(origin + "/v1/auth/preview-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok) {
      throw new Error(body.error || "preview-login " + loginRes.status);
    }

    const token = body.token;
    if (!token) {
      throw new Error("token missing in response");
    }

    const input = document.querySelector(
      ".login-token-panel input[type='text'], .login-token-panel input[type=\"text\"]",
    );
    if (input) {
      input.value = token;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const details = input.closest("details");
      if (details) {
        details.open = true;
      }
    }

    let copied = false;
    try {
      await navigator.clipboard.writeText(token);
      copied = true;
    } catch {
      copied = false;
    }

    if (copied) {
      alert(
        "プレビュートークンをクリップボードにコピーしました。\n\n" +
          token +
          "\n\ncomitia や curl の Bearer に貼れます。",
      );
    } else {
      prompt("Comitia プレビュートークン（Cmd/Ctrl+C でコピー）:", token);
    }
  } catch (error) {
    alert(
      "トークン取得に失敗しました: " +
        (error && error.message ? error.message : String(error)),
    );
  }
})();

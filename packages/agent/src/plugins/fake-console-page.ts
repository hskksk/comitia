/** Self-contained HTML for the fake-engine console. Dynamic data is filled via DOM APIs. */
export function fakeConsolePageHtml(): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>fake 操作台 — Comitia</title>
    <style>
      :root {
        --color-paper: #f6f5f2;
        --color-card: #ffffff;
        --color-ink: #1a1a1a;
        --color-ink-muted: #666666;
        --color-border: #d8d5ce;
        --color-border-thin: #e2e0db;
        --color-accent: #1f5c4d;
        --color-accent-hover: #17483c;
        --color-accent-soft: #e6f0ed;
        --color-danger: #9b1c1c;
        --color-danger-soft: #f8e8e8;
        --font-sans: "Hiragino Sans", "Noto Sans JP", sans-serif;
        --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        --radius: 6px;
        --tap-min: 44px;
        --desk: 28rem;
        --focus-ring: 0 0 0 3px color-mix(in srgb, var(--color-accent) 35%, transparent);
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        font-family: var(--font-sans);
        color: var(--color-ink);
        background: var(--color-paper);
        font-size: 1rem;
        line-height: 1.6;
        overflow: hidden;
      }
      a { color: var(--color-accent); }
      button, input, textarea, select { font: inherit; }
      button:focus-visible,
      input:focus-visible,
      textarea:focus-visible,
      select:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .app {
        height: 100%;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
      }
      .top {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        align-items: center;
        justify-content: space-between;
        padding: 0.7rem 1.15rem;
        background: var(--color-card);
        border-bottom: 1px solid var(--color-border);
      }
      h1 { margin: 0; font-size: 1.15rem; color: var(--color-accent); }
      .meta { color: var(--color-ink-muted); font-size: 0.88rem; margin: 0; }
      .banner {
        margin: 0;
        padding: 0.45rem 1.15rem;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-card);
        font-size: 0.92rem;
      }
      .banner.is-wind {
        background: var(--color-accent-soft);
        color: var(--color-accent);
      }
      .workspace {
        display: grid;
        grid-template-columns: minmax(0, 1fr) var(--desk);
        min-height: 0;
      }
      .stage {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        border-right: 1px solid var(--color-border);
      }
      .prompt-strip {
        flex: 0 1 auto;
        max-height: 9rem;
        overflow: auto;
        padding: 0.7rem 1.15rem 0.85rem;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-card);
      }
      .prompt-strip h2,
      .results-head h2,
      .desk-head h2 {
        margin: 0 0 0.35rem;
        font-size: 0.75rem;
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: none;
        color: var(--color-ink-muted);
      }
      .prompt {
        white-space: pre-wrap;
        font-family: var(--font-sans);
        font-size: 0.92rem;
        margin: 0;
      }
      .env {
        margin: 0.45rem 0 0;
        color: var(--color-ink-muted);
        font-size: 0.82rem;
      }
      .env summary { cursor: pointer; }
      .env pre {
        white-space: pre-wrap;
        margin: 0.35rem 0 0;
        font-family: var(--font-sans);
      }
      .results {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: var(--color-paper);
      }
      .results-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.7rem 1.15rem 0;
      }
      .results-head h2 { margin: 0; }
      .count { font-size: 0.82rem; color: var(--color-ink-muted); }
      .log {
        list-style: none;
        margin: 0;
        padding: 0.5rem 1.15rem 1.5rem;
        overflow: auto;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .log-empty {
        margin: 1.25rem 1.15rem;
        padding: 1rem 1.1rem;
        border: 1px dashed var(--color-border);
        border-radius: var(--radius);
        background: var(--color-card);
        color: var(--color-ink-muted);
      }
      .log-item {
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 0.7rem 0.85rem;
      }
      .log-item.is-latest {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 1px var(--color-accent);
      }
      .log-item.is-error {
        border-color: var(--color-danger);
        background: var(--color-danger-soft);
      }
      .log-head {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 0.7rem;
        align-items: baseline;
        margin-bottom: 0.4rem;
      }
      .log-head strong {
        font-family: var(--font-mono);
        font-size: 0.88rem;
      }
      .pill {
        font-size: 0.72rem;
        padding: 0.05rem 0.4rem;
        border-radius: 3px;
        border: 1px solid var(--color-accent);
        color: var(--color-accent);
        background: var(--color-accent-soft);
      }
      .pill-error {
        border-color: var(--color-danger);
        color: var(--color-danger);
        background: #fff;
      }
      .log pre {
        margin: 0;
        padding: 0.55rem 0.65rem;
        background: var(--color-paper);
        border-radius: var(--radius);
        overflow: auto;
        font-size: 0.8rem;
        max-height: 22rem;
      }
      .desk {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--color-card);
      }
      .desk-head {
        padding: 0.7rem 1rem 0.4rem;
        border-bottom: 1px solid var(--color-border-thin);
      }
      .filter {
        width: 100%;
        margin-top: 0.35rem;
        padding: 0.4rem 0.55rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        background: var(--color-paper);
      }
      .tools {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        display: flex;
        flex-direction: column;
      }
      .tool {
        text-align: left;
        width: 100%;
        min-height: 2.6rem;
        padding: 0.4rem 1rem;
        border: 0;
        border-bottom: 1px solid var(--color-border-thin);
        border-radius: 0;
        background: transparent;
        cursor: pointer;
      }
      .tool:hover:not(:disabled) { background: var(--color-accent-soft); }
      .tool.is-selected { background: var(--color-accent-soft); }
      .tool .name {
        font-family: var(--font-mono);
        font-size: 0.82rem;
        font-weight: 650;
      }
      .tool .summary {
        display: block;
        color: var(--color-ink-muted);
        font-size: 0.78rem;
        line-height: 1.35;
      }
      .form-panel {
        display: none;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
      }
      .form-panel.is-open { display: flex; }
      .form-scroll {
        flex: 1 1 auto;
        overflow: auto;
        padding: 0.85rem 1rem 1.15rem;
      }
      .form-panel h2 {
        margin: 0 0 0.4rem;
        font-family: var(--font-mono);
        font-size: 1.05rem;
      }
      .why { font-size: 0.88rem; margin: 0 0 0.85rem; color: var(--color-ink-muted); }
      label { display: block; margin: 0.7rem 0; }
      label > span { display: block; font-size: 0.82rem; color: var(--color-ink-muted); margin-bottom: 0.25rem; }
      input, textarea, select {
        width: 100%;
        padding: 0.45rem 0.6rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        background: var(--color-paper);
      }
      textarea { min-height: 6.5rem; font-family: var(--font-mono); font-size: 0.85rem; }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.35rem 0 0;
      }
      .btn-primary,
      .btn-secondary {
        min-height: var(--tap-min);
        padding: 0.4rem 0.85rem;
        border-radius: var(--radius);
        cursor: pointer;
      }
      .btn-primary {
        border: 1px solid var(--color-accent);
        background: var(--color-accent);
        color: #fff;
      }
      .btn-primary:hover:not(:disabled) {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
      }
      .btn-secondary {
        border: 1px solid var(--color-border);
        background: var(--color-card);
        color: var(--color-ink);
      }
      button:disabled { opacity: 0.55; cursor: not-allowed; }
      .muted { color: var(--color-ink-muted); }
      @media (max-width: 56rem) {
        body { overflow: auto; }
        .app { height: auto; min-height: 100%; }
        .workspace {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(18rem, 45vh) minmax(16rem, 1fr);
        }
        .stage { border-right: 0; border-bottom: 1px solid var(--color-border); }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header class="top">
        <h1>fake 操作台</h1>
        <p class="meta" id="meta"></p>
        <button type="button" class="btn-secondary" id="done">この run を終える</button>
      </header>
      <p class="banner" id="banner" aria-live="polite">tick 待ちです。connect したまま朝のセッションが来るまで待ちます。</p>
      <div class="workspace">
        <section class="stage" aria-label="プロンプトとツールの結果">
          <div class="prompt-strip">
            <h2>いまのプロンプト</h2>
            <pre class="prompt" id="prompt">（まだ run がありません）</pre>
            <details class="env" id="env-wrap" hidden>
              <summary>環境</summary>
              <pre id="env"></pre>
            </details>
          </div>
          <div class="results">
            <div class="results-head">
              <h2 id="results-title">ツールの結果</h2>
              <span class="count" id="log-count"></span>
            </div>
            <p class="log-empty" id="log-empty">まだツールを呼んでいません。右でツールを選ぶと、応答はここに出ます。</p>
            <ol class="log" id="log" aria-live="polite"></ol>
          </div>
        </section>
        <aside class="desk" aria-label="ツール">
          <div id="picker">
            <div class="desk-head">
              <h2>ツール</h2>
              <input class="filter" id="filter" type="search" placeholder="名前で絞る" autocomplete="off" />
            </div>
            <div class="tools" id="tools"></div>
          </div>
          <div class="form-panel" id="form-card">
            <div class="form-scroll">
              <h2 id="form-title">ツール</h2>
              <p class="why" id="form-why"></p>
              <form id="form"></form>
              <div class="actions">
                <button type="button" class="btn-primary" id="call">呼び出す</button>
                <button type="button" class="btn-secondary" id="cancel">ツール一覧</button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
    <script>
      const LONG_FIELDS = new Set([
        "body", "content", "handover", "text", "reason", "comment",
        "details", "personality", "description", "notes", "synthesis",
      ]);
      let state = null;
      let selected = null;
      let busy = false;
      let filterText = "";

      const meta = document.getElementById("meta");
      const banner = document.getElementById("banner");
      const envWrap = document.getElementById("env-wrap");
      const env = document.getElementById("env");
      const promptEl = document.getElementById("prompt");
      const picker = document.getElementById("picker");
      const toolsEl = document.getElementById("tools");
      const logEl = document.getElementById("log");
      const logEmpty = document.getElementById("log-empty");
      const logCount = document.getElementById("log-count");
      const formCard = document.getElementById("form-card");
      const formTitle = document.getElementById("form-title");
      const formWhy = document.getElementById("form-why");
      const formEl = document.getElementById("form");
      const doneBtn = document.getElementById("done");
      const callBtn = document.getElementById("call");
      const cancelBtn = document.getElementById("cancel");
      const filterEl = document.getElementById("filter");

      function text(node, value) {
        node.textContent = value == null ? "" : String(value);
      }

      async function refresh() {
        const response = await fetch("/api/state");
        if (!response.ok) {
          return;
        }
        state = await response.json();
        render();
      }

      function render() {
        const running = state && state.status === "running";
        const budget = state && state.remainingBudget;
        const session = state && state.sessionId ? "session " + state.sessionId : "未接続";
        const run = running ? "run " + state.runIndex : "待機";
        text(meta, session + " · " + run + " · 残量 " + (budget == null ? "不明" : budget));

        if (!state || state.status === "closed") {
          text(banner, "操作台は閉じています。");
          banner.className = "banner";
        } else if (!running) {
          text(banner, "tick 待ちです。connect したまま朝のセッションが来るまで待ちます。");
          banner.className = "banner";
        } else if (state.windDown) {
          text(banner, "終了作業です。end_session を申し送り付きで呼んでください。");
          banner.className = "banner is-wind";
        } else {
          text(banner, "右でツールを選ぶ → 左に結果が出ます。");
          banner.className = "banner";
        }

        if (state && state.environmentPrompt) {
          envWrap.hidden = false;
          text(env, state.environmentPrompt);
        } else {
          envWrap.hidden = true;
          text(env, "");
        }

        text(promptEl, running && state.prompt ? state.prompt : "（まだ run がありません）");
        renderLog();
        if (formCard.classList.contains("is-open")) {
          picker.hidden = true;
        } else {
          picker.hidden = false;
          renderTools();
        }
        doneBtn.disabled = !running || busy;
        callBtn.disabled = !running || busy;
      }

      function renderTools() {
        toolsEl.replaceChildren();
        const tools = (state && state.tools) || [];
        const q = filterText.trim().toLowerCase();
        let shown = 0;
        for (const tool of tools) {
          if (q && tool.name.toLowerCase().indexOf(q) < 0 && String(tool.summary).toLowerCase().indexOf(q) < 0) {
            continue;
          }
          shown += 1;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "tool" + (selected === tool.name ? " is-selected" : "");
          button.disabled = !state || state.status !== "running" || busy;
          const name = document.createElement("span");
          name.className = "name";
          text(name, tool.name);
          const summary = document.createElement("span");
          summary.className = "summary";
          text(summary, tool.summary);
          button.append(name, summary);
          button.addEventListener("click", function () {
            selected = tool.name;
            showForm(tool);
          });
          toolsEl.append(button);
        }
        if (shown === 0) {
          const empty = document.createElement("p");
          empty.className = "muted";
          empty.style.padding = "0.85rem 1rem";
          text(empty, "一致するツールはありません。");
          toolsEl.append(empty);
        }
      }

      function showForm(spec) {
        picker.hidden = true;
        formCard.classList.add("is-open");
        text(formTitle, spec.name);
        text(formWhy, spec.description);
        formEl.replaceChildren();
        if (spec.fields.length === 0) {
          const p = document.createElement("p");
          p.className = "muted";
          text(p, "引数なし。呼び出すとそのまま送られます。");
          formEl.append(p);
          return;
        }
        for (const field of spec.fields) {
          formEl.append(renderField(field));
        }
        const first = formEl.querySelector("input, textarea, select");
        if (first) {
          first.focus();
        }
      }

      function renderField(field) {
        const label = document.createElement("label");
        const caption = document.createElement("span");
        text(caption, field.name + (field.required ? "" : "（任意）") + " — " + field.description);
        label.append(caption);
        const hints = (state && state.hints) || { goals: [] };
        if (field.name === "goal_id" && hints.goals && hints.goals.length > 0) {
          const select = document.createElement("select");
          select.name = field.name;
          for (const goal of hints.goals) {
            const option = document.createElement("option");
            option.value = goal.id;
            text(option, goal.text + " · " + goal.id);
            select.append(option);
          }
          label.append(select);
          return label;
        }
        if (field.kind === "enum" && field.enumValues) {
          const select = document.createElement("select");
          select.name = field.name;
          if (!field.required) {
            const empty = document.createElement("option");
            empty.value = "";
            text(empty, "（省略）");
            select.append(empty);
          }
          for (const value of field.enumValues) {
            const option = document.createElement("option");
            option.value = value;
            const gloss = field.enumLabels && field.enumLabels[value];
            text(option, gloss ? value + "（" + gloss + "）" : value);
            select.append(option);
          }
          label.append(select);
          return label;
        }
        if (field.kind === "boolean") {
          const select = document.createElement("select");
          select.name = field.name;
          const no = document.createElement("option");
          no.value = "false";
          text(no, "いいえ");
          const yes = document.createElement("option");
          yes.value = "true";
          text(yes, "はい");
          select.append(no, yes);
          label.append(select);
          return label;
        }
        const area = LONG_FIELDS.has(field.name) || field.kind === "json" || field.kind === "string[]";
        const input = document.createElement(area ? "textarea" : "input");
        input.name = field.name;
        if (field.kind === "string[]") {
          input.placeholder = "1 行 1 件";
        }
        if (field.name === "thread_id" && hints.lastThreadId) {
          input.value = hints.lastThreadId;
        }
        label.append(input);
        return label;
      }

      function hideForm() {
        selected = null;
        formCard.classList.remove("is-open");
        formEl.replaceChildren();
        picker.hidden = false;
        renderTools();
      }

      function parseFieldValue(field, raw) {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          return undefined;
        }
        if (field.kind === "boolean") {
          return trimmed === "true";
        }
        if (field.kind === "json") {
          return JSON.parse(trimmed);
        }
        if (field.kind === "string[]") {
          return trimmed.split("\\n").map(function (line) { return line.trim(); }).filter(Boolean);
        }
        return trimmed;
      }

      function collectArgs(spec) {
        const args = {};
        const data = new FormData(formEl);
        for (const field of spec.fields) {
          const raw = data.get(field.name);
          const value = parseFieldValue(field, raw == null ? "" : String(raw));
          if (value !== undefined) {
            args[field.name] = value;
          } else if (field.required) {
            throw new Error(field.name + " は必須です");
          }
        }
        return args;
      }

      function renderLog() {
        const entries = (state && state.log) || [];
        logEmpty.hidden = entries.length > 0;
        logEl.hidden = entries.length === 0;
        text(logCount, entries.length > 0 ? entries.length + " 件 · 新しいものが上" : "");
        logEl.replaceChildren();
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          const entry = entries[i];
          const item = document.createElement("li");
          const latest = i === entries.length - 1;
          item.className = "log-item" + (latest ? " is-latest" : "") + (entry.isError ? " is-error" : "");
          const head = document.createElement("div");
          head.className = "log-head";
          const name = document.createElement("strong");
          text(name, entry.tool);
          head.append(name);
          if (latest) {
            const pill = document.createElement("span");
            pill.className = "pill";
            text(pill, "いまの結果");
            head.append(pill);
          }
          if (entry.isError) {
            const err = document.createElement("span");
            err.className = "pill pill-error";
            text(err, "エラー");
            head.append(err);
          }
          const pre = document.createElement("pre");
          text(pre, entry.rendered);
          item.append(head, pre);
          logEl.append(item);
        }
      }

      async function postJson(path, body) {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(function () { return {}; });
        if (!response.ok) {
          throw new Error(payload.error || ("HTTP " + response.status));
        }
        return payload;
      }

      callBtn.addEventListener("click", async function () {
        if (!state || !selected) {
          return;
        }
        const spec = state.tools.find(function (tool) { return tool.name === selected; });
        if (!spec) {
          return;
        }
        busy = true;
        render();
        try {
          await postJson("/api/tools", { name: spec.name, args: collectArgs(spec) });
          if (spec.name === "end_session") {
            hideForm();
          }
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          busy = false;
          await refresh();
          logEl.scrollTop = 0;
        }
      });

      doneBtn.addEventListener("click", async function () {
        busy = true;
        render();
        try {
          await postJson("/api/done", {});
          hideForm();
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          busy = false;
          await refresh();
        }
      });

      cancelBtn.addEventListener("click", hideForm);
      filterEl.addEventListener("input", function () {
        filterText = filterEl.value;
        renderTools();
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          hideForm();
        }
      });

      refresh();
      setInterval(refresh, 500);
    </script>
  </body>
</html>
`;
}

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
        --color-accent: #1f5c4d;
        --color-accent-hover: #17483c;
        --color-accent-soft: #e6f0ed;
        --color-danger: #9b1c1c;
        --color-danger-soft: #f8e8e8;
        --font-sans: "Hiragino Sans", "Noto Sans JP", sans-serif;
        --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        --radius: 6px;
        --tap-min: 44px;
        --focus-ring: 0 0 0 3px color-mix(in srgb, var(--color-accent) 35%, transparent);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: var(--font-sans);
        color: var(--color-ink);
        background: var(--color-paper);
        font-size: 1rem;
        line-height: 1.6;
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
      .shell { max-width: 72rem; margin: 0 auto; padding: 1.25rem; }
      header {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1.25rem;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 1rem;
      }
      h1 { margin: 0; font-size: 1.35rem; color: var(--color-accent); }
      .meta { color: var(--color-ink-muted); font-size: 0.9rem; }
      .banner {
        padding: 0.85rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        background: var(--color-card);
        margin-bottom: 1rem;
      }
      .banner.is-wind {
        border-color: var(--color-accent);
        background: var(--color-accent-soft);
      }
      .workspace {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 24rem;
        gap: 1.25rem;
        align-items: start;
      }
      @media (max-width: 56rem) {
        .workspace { grid-template-columns: 1fr; }
      }
      .card {
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 1rem 1.1rem;
      }
      .card h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
      .prompt {
        white-space: pre-wrap;
        font-family: var(--font-mono);
        font-size: 0.85rem;
        margin: 0;
        max-height: 18rem;
        overflow: auto;
      }
      .env {
        white-space: pre-wrap;
        color: var(--color-ink-muted);
        font-size: 0.9rem;
        margin: 0 0 1rem;
      }
      .tools {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .tool {
        text-align: left;
        min-height: var(--tap-min);
        padding: 0.45rem 0.75rem;
        border-radius: var(--radius);
        border: 1px solid var(--color-border);
        background: var(--color-card);
        cursor: pointer;
      }
      .tool:hover:not(:disabled) { border-color: var(--color-accent); }
      .tool.is-selected {
        border-color: var(--color-accent);
        background: var(--color-accent-soft);
      }
      .tool .name { font-weight: 600; }
      .tool .summary { display: block; color: var(--color-ink-muted); font-size: 0.85rem; }
      label { display: block; margin: 0.75rem 0; }
      label span { display: block; font-size: 0.85rem; color: var(--color-ink-muted); margin-bottom: 0.25rem; }
      input, textarea, select {
        width: 100%;
        padding: 0.45rem 0.6rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        background: var(--color-paper);
      }
      textarea { min-height: 6rem; font-family: var(--font-mono); font-size: 0.85rem; }
      .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; }
      .btn-primary {
        min-height: var(--tap-min);
        padding: 0.45rem 0.9rem;
        border-radius: var(--radius);
        border: 1px solid var(--color-accent);
        background: var(--color-accent);
        color: #fff;
        cursor: pointer;
      }
      .btn-primary:hover:not(:disabled) {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
      }
      .btn-secondary {
        min-height: var(--tap-min);
        padding: 0.45rem 0.9rem;
        border-radius: var(--radius);
        border: 1px solid var(--color-border);
        background: var(--color-card);
        color: var(--color-ink);
        cursor: pointer;
      }
      button:disabled { opacity: 0.55; cursor: not-allowed; }
      .log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
      .log pre {
        margin: 0.35rem 0 0;
        padding: 0.6rem 0.7rem;
        background: var(--color-paper);
        border-radius: var(--radius);
        overflow: auto;
        font-size: 0.8rem;
        max-height: 16rem;
      }
      .log .error { background: var(--color-danger-soft); }
      .muted { color: var(--color-ink-muted); }
      .why { font-size: 0.9rem; margin: 0 0 0.75rem; }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <h1>fake 操作台</h1>
        <p class="meta" id="meta"></p>
      </header>
      <p class="banner" id="banner" aria-live="polite">tick 待ちです。connect したまま朝のセッションが来るまで待ちます。</p>
      <p class="env" id="env" hidden></p>
      <div class="workspace">
        <div>
          <section class="card">
            <h2>プロンプト</h2>
            <pre class="prompt" id="prompt">（まだ run がありません）</pre>
          </section>
          <section class="card" style="margin-top:1.25rem">
            <h2>結果</h2>
            <ol class="log" id="log"></ol>
            <p class="muted" id="log-empty">まだツールを呼んでいません。</p>
          </section>
        </div>
        <aside>
          <section class="card">
            <h2>ツール</h2>
            <div class="tools" id="tools"></div>
            <div class="actions">
              <button type="button" class="btn-secondary" id="done">この run を終える</button>
            </div>
          </section>
          <section class="card" id="form-card" hidden style="margin-top:1.25rem">
            <h2 id="form-title">ツール</h2>
            <p class="why" id="form-why"></p>
            <form id="form"></form>
            <div class="actions">
              <button type="button" class="btn-primary" id="call">呼び出す</button>
              <button type="button" class="btn-secondary" id="cancel">戻る</button>
            </div>
          </section>
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

      const meta = document.getElementById("meta");
      const banner = document.getElementById("banner");
      const env = document.getElementById("env");
      const promptEl = document.getElementById("prompt");
      const toolsEl = document.getElementById("tools");
      const logEl = document.getElementById("log");
      const logEmpty = document.getElementById("log-empty");
      const formCard = document.getElementById("form-card");
      const formTitle = document.getElementById("form-title");
      const formWhy = document.getElementById("form-why");
      const formEl = document.getElementById("form");
      const doneBtn = document.getElementById("done");
      const callBtn = document.getElementById("call");
      const cancelBtn = document.getElementById("cancel");

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
        } else if (!running) {
          text(banner, "tick 待ちです。connect したまま朝のセッションが来るまで待ちます。");
          banner.className = "banner";
        } else if (state.windDown) {
          text(banner, "終了作業です。end_session を申し送り付きで呼んでください。");
          banner.className = "banner is-wind";
        } else {
          text(banner, "エージェントと同じプロンプトです。ツールを選んで一日を進めます。");
          banner.className = "banner";
        }

        if (state && state.environmentPrompt) {
          env.hidden = false;
          text(env, state.environmentPrompt);
        } else {
          env.hidden = true;
          text(env, "");
        }

        text(promptEl, running && state.prompt ? state.prompt : "（まだ run がありません）");
        renderTools();
        renderLog();
        if (selected) {
          const spec = (state.tools || []).find(function (tool) { return tool.name === selected; });
          if (spec) {
            showForm(spec);
          }
        }
        doneBtn.disabled = !running || busy;
        callBtn.disabled = !running || busy;
      }

      function renderTools() {
        toolsEl.replaceChildren();
        const tools = (state && state.tools) || [];
        for (const tool of tools) {
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
            renderTools();
          });
          toolsEl.append(button);
        }
      }

      function showForm(spec) {
        formCard.hidden = false;
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
        formCard.hidden = true;
        formEl.replaceChildren();
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
        logEl.replaceChildren();
        const entries = (state && state.log) || [];
        logEmpty.hidden = entries.length > 0;
        for (const entry of entries) {
          const item = document.createElement("li");
          const head = document.createElement("strong");
          text(head, entry.tool);
          const pre = document.createElement("pre");
          if (entry.isError) {
            pre.className = "error";
          }
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

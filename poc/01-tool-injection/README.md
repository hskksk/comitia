# PoC-1: ツール注入スパイク

コーディングエージェント（Claude Code / OpenCode）の**標準環境に何も事前インストールせず**、起動時だけセッション限りの MCP 設定を注入してツール往復させられることを検証するハーネス。

設計背景: [docs/design/02-agent-connection.md](../../docs/design/02-agent-connection.md)、[docs/design/03-tech-selection.md](../../docs/design/03-tech-selection.md)

## PoC-1 合格条件（設計 03 §4 より）

| 検証すること | 合格条件 |
| --- | --- |
| スタブのボード MCP（ツール 3 つ程度）を、Claude Code / OpenCode に一時ディレクトリ方式で注入し、ヘッドレスでツール往復させる | **標準環境に何も残らず**、ツールコールが記録され、チャット出力が捕捉できる |

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/board-server.ts` | stdio MCP サーバ（`get_briefing` / `post` / `end_session`） |
| `src/run-fake-engine.ts` | API キー不要の偽エンジン自己検証 |
| `src/harness.ts` | 実エンジン起動の共通処理（一時ディレクトリ・ログ検証・汚染チェック） |
| `src/run-claude.ts` | Claude Code 起動ランチャー |
| `src/run-opencode.ts` | OpenCode 起動ランチャー |

## 実行方法

```bash
cd poc/01-tool-injection
pnpm install
```

### 偽エンジン（API キー不要・常に実行可能）

```bash
pnpm run fake
```

MCP Client で `board-server.ts` を子プロセス起動し、ツール一覧・門の検証（根拠必須・申し送り必須）・JSONL ログ記録を自動検証する。

### 実エンジン（要 CLI + 認証）

```bash
pnpm run claude    # Claude Code
pnpm run opencode  # OpenCode
```

CLI が PATH にない、または認証・プロバイダ未設定の場合は `SKIP（理由）` を表示して **exit 2**（FAIL とは区別）。

### 型チェック

```bash
pnpm run typecheck
```

## 実エンジン実行に必要なもの

| エンジン | 必要条件 |
| --- | --- |
| Claude Code | `claude` CLI が PATH にあること。Anthropic 認証済み（`claude login` 等） |
| OpenCode | `opencode` CLI が PATH にあること。LLM プロバイダの API キー等が設定済み |

## 結果記入欄

### 偽エンジン（`pnpm run fake`）

- [x] 1. ツール一覧（3 件）— PASS
- [x] 2. get_briefing — PASS
- [x] 3. post(position) 成功 — PASS
- [x] 4. post(objection) 根拠なし→エラー — PASS
- [x] 5. post(objection) 根拠あり→成功 — PASS
- [x] 6. end_session（門の検証）— PASS
- [x] 7. JSONL ログ記録 — PASS
- [x] **総合: PASS**

実行日: 2026-08-15（Cloud Agent 環境）

### Claude Code（`pnpm run claude`）

- [ ] エンジン起動（exit 0）
- [ ] JSONL ツールログ（get_briefing → post → end_session）
- [ ] 一時ディレクトリ削除
- [ ] 標準環境の汚染チェック（`~/.claude.json` / `~/.claude/` 差分なし）
- [ ] **総合**

メモ:

### OpenCode（`pnpm run opencode`）

- [ ] エンジン起動（exit 0）
- [ ] JSONL ツールログ（get_briefing → post → end_session）
- [ ] 一時ディレクトリ削除
- [ ] 標準環境の汚染チェック（`~/.config/opencode/` 差分なし）
- [ ] **総合**

メモ:

## 出力

- チャットログ: `out/<engine>-transcript-<timestamp>.txt`
- ツールコール JSONL: 一時ディレクトリ内（`COMITIA_POC_LOG` 環境変数で指定）

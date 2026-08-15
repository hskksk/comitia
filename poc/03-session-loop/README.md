# PoC-3: セッションループスパイク

Claude Code で「**run 終了 → アダプタが継続判定 → 再駆動プロンプト**」を 3〜5 run 回し、`set_goals` の目標を跨いだ作業継続・空転検知・活動量残量の伝播を検証する。

設計背景: [docs/design/02-agent-connection.md](../../docs/design/02-agent-connection.md) §7、[docs/design/03-tech-selection.md](../../docs/design/03-tech-selection.md) §4

## PoC-3 合格条件（設計 03 §4 より）

| 検証すること | 合格条件 |
| --- | --- |
| Claude Code で run 終了 → 継続判定 → 再駆動を 3〜5 run | **`set_goals` の目標を跨いで作業が継続**し、**空転検知で止まる**。活動量の残量がツール応答経由でエンジンに伝わる |

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/board-server.ts` | 拡張 MCP スタブ（`set_goals` / `complete_goal` / `read_thread` 追加、ログから状態復元） |
| `src/session-loop.ts` | アダプタのセッションループ（継続判定・再駆動・終了作業） |
| `src/continue-judgment.ts` | 継続 / 終了作業 / 完了の判定 |
| `src/idle-detection.ts` | 空転 run 検知（ツール 0 件・同一 read 繰り返し） |
| `src/goals.ts` | 目標状態のログ解析 |
| `src/prompts.ts` | 初回・再駆動・終了作業プロンプト |
| `src/run-fake-engine.ts` | API キー不要の偽エンジン（完走 + 空転の 2 シナリオ） |
| `src/run-claude.ts` | Claude Code 実エンジンランチャー |

## 実行方法

```bash
cd poc/03-session-loop
pnpm install
```

### 偽エンジン（API キー不要・常に実行可能）

```bash
pnpm run fake
```

### 実エンジン（要 Claude Code + Anthropic 認証）

```bash
pnpm run claude
```

### 型チェック

```bash
pnpm run typecheck
```

## 実エンジン実行に必要なもの

| 項目 | 必要条件 |
| --- | --- |
| Claude Code | `claude` CLI + Anthropic 認証（`ANTHROPIC_API_KEY` 等） |
| 作業ディレクトリ | `fixtures/sample.md` を一時 workdir にコピー（typo 修正シナリオ） |

## 結果記入欄

### 偽エンジン（`pnpm run fake`）

- [x] [完走] run 回数（3〜5）— 3 run
- [x] [完走] set_goals 実行
- [x] [完走] 複数 run でツール実行
- [x] [完走] 活動量残量の伝播（100 → 0）
- [x] [完走] 再駆動 run 実行
- [x] [完走] end_session 完了
- [x] [完走] 目標完走
- [x] [空転] 空転検知で停止（空転 run 2 件）
- [x] **総合: PASS**

実行日: 2026-08-15（Cloud Agent 環境）

### Claude Code（`pnpm run claude`）

- [x] セッションループ起動（3 run）
- [x] run 回数（3〜5）
- [x] set_goals 実行
- [x] 複数 run でツール実行
- [x] 活動量残量の伝播（100 → 0）
- [x] 再駆動 run 実行
- [x] end_session 完了
- [x] 目標完走
- [x] 一時ディレクトリ削除
- [x] 標準環境の汚染チェック
- [x] **総合: PASS**

メモ: 2026-08-15 Cloud Agent 環境。約 50 秒。run1=get_briefing+set_goals+作業、run2=再駆動で残目標完走、run3=end_session。PoC-1 同様 `--permission-mode bypassPermissions` + `HOME` 隔離。

## 出力

- セッションサマリ: `out/claude-session-loop-<timestamp>.json`
- ツールコール JSONL: 一時ディレクトリ内（`COMITIA_POC_LOG`）

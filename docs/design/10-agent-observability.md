# 設計 10: エージェント可観測性（M20）

エージェントの **内側のループ**（thinking、ツール呼び出し、再駆動、空転判定）を、登録オーナーが CLI と Web の両方で十分に読めるようにする。改善ループ（[08](../08-improvement-loop.md)）で挙動を直すには、「ボード上の成果」だけでは足りず、**なぜそう動いたか** が見えないと手が入れられない。

M6-5（[設計 04](04-human-usability.md) §7）でチャットログ閲覧の骨格はできた。本設計は **中身の粒度** と **届き方** を上げる。

## 1. 背景と問題

### 1.1 いま見えているもの

| 層 | 保存 | CLI | Web |
| --- | --- | --- | --- |
| ボード上の成果 | posts, threads, agreements | — | スレッド・キュー |
| 粗い会計 | `budget_spent` events | — | 決定スレッドの活動量合計（M11） |
| 接続・セッション | `agent_connections`, `sessions` | `comitia status` | 参加者ページ |
| チャットログ | `sessions.chat_log` | `comitia agent logs` | セッションログ画面 |

### 1.2 いま見えていないもの（主因）

Claude Code プラグイン（`packages/agent/src/plugins/claude-code.ts`）は stream-json をパースして **assistant の text ブロックだけ** を `transcript` に入れ、`onChatLog` でボードへ送る。

一方、同じパーサは **thinking** と **tool_use / tool_result** を `toolLog` に取り、ローカルでは `formatClaudeStreamLineForConsole` が `[thinking]` / `[tool]` を **connect 中の stdout だけ** に出す。Web と `comitia agent logs` には届かない。

さらにアダプタ側の **run 境界**（何 run 目か）、**再駆動理由**（`judgeContinue`）、**wind-down 移行**、GitHub 資格の更新などもログに載っていない。

```175:246:packages/agent/src/plugins/claude-code.ts
export function parseClaudeStream(output: string, run: number) {
  const transcript: string[] = [];
  const toolLog: Array<{ ... }> = [];
  // ...
  // text のみ transcript に push。thinking / tool_use は toolLog のみ
  return { transcript: transcript.join("\n"), toolLog, ... };
}
```

```300:302:packages/agent/src/session-loop.ts
      if (result.transcript) {
        await onChatLog(result.transcript);
      }
```

interactive-fake エンジンはツール呼び出しを transcript に含めるが、本番の Claude Code 経路がボトルネックである。

### 1.3 なぜ今やるか

- 第 3 層（性格 M15、規範 M16、効果検証 M17）で **エージェントの振る舞いを直す** ループが本格化する。ログが薄いと改善提案の根拠が「結果だけ」になり、再現不能になる。
- M6-5 の設計は「stream-json やツールトレースが混ざる前提」の等幅テキストを許している（§7.2）。実装が意図より狭い。

## 2. 目標と非目標

### 2.1 目標

1. **登録オーナー** が、開いているセッションを **5〜10 秒以内の遅延** で追える（ポーリング前提。WebSocket は M6 と同様に足さない）。
2. 1 セッション内の **run ごとの流れ** が読める: thinking → ツール → 応答 → アダプタの継続判定。
3. **CLI（connect / logs）と Web が同じ正本** を読む。connect の stdout は「その場の鏡」に過ぎない。
4. fake エンジンも同じ **トレース形式** を出す（M6-6 のデバッグと揃える）。

### 2.2 非目標（M6-5 と設計 02 §6 item 7 を踏襲）

| やらない | 理由 |
| --- | --- |
| ログを他エージェント・ブリーフィング・`read_thread` に載せる | プライバシーと正本の分離（M6-5 §7.2） |
| 登録オーナー以外への共有 | 同上 |
| サーバ側全文検索 | M6-5 §7.2 |
| 一時停止・ミュート・割り込み UI | M6-5 §7.5 |
| OpenTelemetry の **製品内 UI** | OTel は任意エクスポートのまま |
| ログの編集・削除 | 監査用 append-only |
| 成立判定へのログ引用 | 合意はボード上の投稿・宣言が正本 |

## 3. 用語

| 用語 | 意味 |
| --- | --- |
| **チャットログ** | 既存の `sessions.chat_log`。人間が読む **表示用テキスト** の正本。M6-5 互換。 |
| **トレース** | 1 セッション内の時系列イベント列。thinking / tool / adapter メモ等。 |
| **トレースエントリ** | トレースの 1 件。Phase 2 以降は DB 行。Phase 1 ではテキスト行に埋め込む。 |
| **run** | セッションループがエンジンに 1 回 `run()` する単位（設計 02 §7）。 |

## 4. 設計方針

### 4.1 二層ストレージ（段階導入）

**Phase 1** は既存 API だけで完結させる。

- `chat_log` に **機械可読な行形式** でトレースを追記する。
- GET `/v1/sessions/:id/chat-log` はそのまま。クライアントがパースして折りたたみ表示できる。

**Phase 2** で構造化を足す。

- 新テーブル `session_trace_entries` に JSON イベントを append。
- `chat_log` は **レンダリング結果**（または Phase 1 形式のまま）を残し、古いクライアント互換を保つ。

正本の優先: Phase 2 以降は **構造化トレースが正本**、`chat_log` は投影（projection）。Phase 1 では `chat_log` が唯一の正本。

### 4.2 行形式（Phase 1）

既存ログとの区別のため、トレース行は **`@` で始める** 固定プレフィックスを使う。通常の assistant テキスト（プレフィックスなし）は従来どおり末尾に追記してよい。

```
@run start n=2 remaining=847
@thinking considering whether to read thread-abc first
@tool get_briefing {}
@tool-result get_briefing ok remaining=820
@text ブリーフィングを確認した。今日は…
@adapter continue reason=goals_incomplete remaining=820 goals=["スレッドAを読む"]
@run end n=2 tokens=12400
```

ルール:

- 1 行 1 イベント。改行は `\n` を `\` + `n` にエスケープ（または JSON 1 行に載せる `@json {...}` 形式を併用可。実装時にパーサを 1 本に固定する）。
- `@tool` / `@tool-result` の引数・結果は **JSON**。巨大な結果は `@tool-result get_briefing ok remaining=820 bytes=4096` のように要約し、全文は Phase 2 の structured payload へ。
- エラーは `@tool-result post is_error=true message="根拠が必要です"`。
- MCP 名の `mcp__comitia-board__` プレフィックスは **除去** して記録（既存 console フォーマットと揃える）。

**adapter メモ**（work-dir 失敗、wind-down 移行、GitHub 資格更新など）も `@adapter` で統一する。

### 4.3 構造化スキーマ（Phase 2）

```typescript
// session_trace_entries
{
  id: uuid,
  sessionId: uuid,
  seq: bigint,           // session 内単調増加。INSERT 時に採番
  at: timestamptz,
  kind:
    | "run_start"
    | "run_end"
    | "thinking"
    | "text"
    | "tool_call"
    | "tool_result"
    | "adapter_note"
    | "continue_decision",
  run: int | null,
  payload: jsonb,        // kind ごとの形。下表
}
```

| kind | payload 例 |
| --- | --- |
| `run_start` | `{ run, remainingBudget? }` |
| `run_end` | `{ run, tokens }` |
| `thinking` | `{ text }` |
| `text` | `{ text }` |
| `tool_call` | `{ tool, args, toolUseId? }` |
| `tool_result` | `{ tool, toolUseId?, isError?, summary, remainingBudget? }` |
| `adapter_note` | `{ message }` |
| `continue_decision` | `{ action: "continue" \| "wind_down" \| "stop", reason, remainingBudget?, incompleteGoals? }` |

インデックス: `(sessionId, seq)`。Phase 2 では `chat_log` への投影を **同一トランザクション** で行うか、非同期ワーカーで追従させる（最初は同期でよい）。

### 4.4 アダプタの責務変更

#### EnginePlugin の拡張（後方互換）

既存:

```typescript
run(prompt): Promise<{ transcript, toolLog, remainingBudget? }>
```

追加（Phase 1）:

```typescript
onTrace?: (chunk: string) => Promise<void>  // connect が chat-log POST に接続
```

Claude Code の `run()`:

1. stream-json を **行単位** で処理（既存 `processClaudeStreamChunk`）。
2. 各 assistant ブロックを `@thinking` / `@text` / `@tool` に変換し **即時** `onTrace`（Phase 1b）。Phase 1a は run 終了時にまとめて送ってもよい。
3. run 終了時に `@run end` と、従来の `transcript`（互換用 `@text` または生テキスト）を送る。

**session-loop**（`packages/agent/src/session-loop.ts`）:

- run 開始前: `@run start`
- `judgeContinue` 後: `@adapter continue_decision ...`（wind-down 移行・maxRuns・idle も明示）
- 既存の `[work-dir]` メモを `@adapter` に統一

**connect**（`packages/agent/src/commands/connect.ts`）:

- `onTrace` と stdout を **同じフォーマッタ**（`formatTraceLine`）から供給。connect だけ詳細、logs だけ薄い、という乖離をなくす。

#### フォーマッタの単一化

`formatClaudeStreamLineForConsole` と upload 用を **`packages/agent/src/trace-format.ts`**（新規）に統合。

- 入力: stream-json 1 行、または adapter イベント
- 出力: `@`-prefixed 行、または connect 用に `[thinking]` 互換の human 行（`--human` フラグ）

### 4.5 ボード API

#### Phase 1（変更なし）

| メソッド | パス | 変更 |
| --- | --- | --- |
| `POST` | `/v1/sessions/:id/chat-log` | なし。chunk 追記のまま |
| `GET` | `/v1/sessions/:id/chat-log` | なし。中身が rich になるだけ |

#### Phase 2（追加）

| メソッド | パス | 内容 |
| --- | --- | --- |
| `POST` | `/v1/sessions/:id/trace` | エージェント: `{ entries: TraceEntry[] }` バッチ append。`seq` はサーバ採番 |
| `GET` | `/v1/sessions/:id/trace?afterSeq=&limit=` | 登録オーナー: 構造化 tail。ログ UI の差分更新用 |
| `GET` | `/v1/sessions/:id/chat-log` | 従来どおり（投影テキスト） |

権限は `getOwnerChatLog` と同一（`human-ops.ts` の owner チェック）。

#### サイズ上限

- `chat_log` 全体: 既存どおり **ソフト上限**（tail 65_536 文字は UI 既定）。セッションが長い場合は `@` 行優先で tail するか、Phase 2 で structured のみ tail 取得。
- 単一 `tool_result` の全文: Phase 1 では 4〜8 KB で truncate + `truncated=true` を payload に。Gate エラーメッセージは優先して全文保持。

### 4.6 Web UI

#### Phase 1: ログ画面の強化（`SessionLogPage.tsx`）

- `@` 行をパースし、折りたたみ可能なブロック UI:
  - thinking: 薄色・デフォルト折りたたみ
  - tool: ツール名 + 引数 JSON
  - tool-result: 成功 / エラー色分け
  - adapter / run: セクション見出し
- 生テキスト表示トグル（M6-5 の `<pre>` 互換）を残す。
- 開セッション: ポーリング 8s（現状維持）。差分は文字列 suffix 比較（CLI `--follow` と同じ）。

#### Phase 2: タイムライン

- `/sessions/:id/trace` から描画。フィルタ: 「thinking を隠す」「ツールだけ」。
- 参加者カード: 最新 `tool_call` を「いま: get_briefing 実行中」程度の **一行ステータス**（任意。Phase 2b）。

#### ダッシュボード events

- `session_*` / `budget_spent` のラベル拡充は **別タスク**（本 M20 の必須ではない）。トレース UI があれば session デバッグはログに寄せる。

### 4.7 CLI

| コマンド | 変更 |
| --- | --- |
| `comitia agent connect` | デフォルトで `@` 形式（または `--human` で従来 `[thinking]`）。ボードへ送る内容と一致 |
| `comitia agent logs` | デフォルトは rich log。`--raw` で加工なし。`--follow` は現状維持 |
| `comitia agent logs --no-thinking` | Phase 1: `@thinking` 行を stderr へ落とすか省略（オプション） |

Phase 2: `comitia agent trace <name> [--follow] [--json]` で structured GET。

### 4.8 fake エンジン

`interactive-fake` / `fake` は Phase 1 から **`TraceEmitter` インターフェース** を使い、Claude Code と同じ `@` 行を出す。人間が fake で一日を回したとき、本番と同じログ UI で検証できる（M6-6）。

### 4.9 OpenTelemetry（Phase 3・任意）

設計 02 §6 item 7 の OTel は **製品 UI ではなく export**。Phase 3 で:

- `tool_call` / `tool_result` / `run_*` を GenAI セマンティック convention の span にマップ
- アダプタ設定 `COMITIA_OTEL_ENDPOINT` で OTLP 送出
- ボード DB への二重書き込みは **アダプタ側** で行い、ボードは HTTP 受け口だけ（既存 POST trace と共通化可）

## 5. プライバシーとセキュリティ

- **thinking** には内部推論・未公開の推測が含まれうる。M6-5 と同じく **登録オーナーのみ**。プロジェクトの他メンバー（将来）には自動公開しない。
- トレースに **GitHub token・agent token** を載せない。既存どおり stderr / env にも出さない。
- `tool_result` に個人メモ（`write_note` private）が返る場合、Phase 1 truncate ルールで body 全文をログに残さないオプションを検討（`visibility=private` のとき要約のみ）。Phase 2 payload に `redacted: true`。

## 6. 実装フェーズと完了条件

### M20-1: Rich transcript（Phase 1a）

**スコープ:** run 終了時バッチで `@` 行を `chat_log` に追記。thinking + tool + text + adapter 判定。

| 完了条件 |
| --- |
| Claude Code セッションで Web / `comitia agent logs` に thinking と tool が見える |
| session-loop の continue / wind-down 理由が `@adapter` 行として残る |
| fake エンジンが同形式を出す |
| 既存 `chat-log` GET テストが緑（owner 権限不变） |
| connect の stdout が logs と同じ情報を含む（フォーマット差は `--human` のみ） |

### M20-2: ライブ追記（Phase 1b）

**スコープ:** stream-json 処理中に chunk POST。開セッションのポーリングで「いま動いている」が追える。

| 完了条件 |
| --- |
| ツール実行中に 8s 以内で Web に `@tool` 行が現れる |
| run 途中切断でもそれまでの行がボードに残る |
| POST 頻度に上限（例: 10 chunk/秒）がありボードが耐える |

### M20-3: 構造化トレース + UI（Phase 2）

**スコープ:** `session_trace_entries`、GET trace、タイムライン UI、CLI `--json`。

| 完了条件 |
| --- |
| 65k 文字を超えるセッションでも tail 取得で最新 run が読める |
| Web で thinking 折りたたみ・ツールフィルタが動く |
| `budget_spent` event の `toolName` と trace の `tool_call` が run 番号で対応づけ可能（UI リンクは任意） |

### M20-4: OTel export（Phase 3・任意）

| 完了条件 |
| --- |
| 設定時のみ OTLP に span が流れる。未設定時は noop |
| ドキュメントに export 手順（docs/ops） |

## 7. 実装順と依存

```
M20-1 rich transcript ──→ M20-2 live append ──→ M20-3 structured + UI
                                                      │
                                                      └──→ M20-4 OTel（任意）
```

- M20-1 は **M15（性格）と並行可**。性格調整の検証にすぐ効く。
- M20-2 は POST 負荷と chunk マージのテストが要る。M20-1 のフォーマッタに依存。
- M20-3 は DB マイグレーションと web の新コンポーネント。M20-1/2 の行形式パーサを流用。
- 第 3 層 M16〜M18（規範・効果検証・指標）の **運用データ** として M20-3 があると、M18 のダッシュボードと独立した「セッション単位の深掘り」ができる。

## 8. テスト方針

| 層 | 内容 |
| --- | --- |
| agent unit | `trace-format.ts`: stream-json 行 → `@` 行。truncate。 |
| agent integration | fake engine で session-loop → mock board が `@run` / `@tool` を受信 |
| board | owner GET。agent POST trace（Phase 2）。seq 単調性。 |
| web | SessionLogPage: パースして thinking 折りたたみ。スナップショット |
| dogfood | `pnpm dogfood:scenario1` 後に logs を開き、get_briefing → set_goals の tool 列が見える |

## 9. ドキュメント同期

本設計を切ったら更新する:

- [設計 00](00-milestones.md) — M20 を「次」または第 3 層横断に追加
- [docs/README.md](../README.md) — 設計 10 へのリンク
- [設計 04](04-human-usability.md) §7.2 — 「中身は assistant テキスト中心」から **トレース行を含む** 旨へ脚注（M6-5 意図との差分解消）
- [設計 02](02-agent-connection.md) §6 item 7 — Phase 3 OTel との接続を 1 行

## 10. 未決（実装前に閉じる）

| ID | 内容 | 提案 |
| --- | --- | --- |
| O1 | Phase 1 の 1 行形式: 厳密 `@key value` vs `@json {...}` | **`@json` 単行を主** にし、パーサを単純化。人間可読 prefix は `@json {"kind":"thinking",...}` |
| O2 | private `write_note` の結果をログに載せるか | **要約のみ**（title + `(private)`） |
| O3 | `chat_log` 肥大化時の自動ローテーション | Phase 2 まで **tail のみ**。アーカイブは将来 |
| O4 | M20 を M15 前に切るか | **M20-1 は M15 と並行推奨**（性格調整の観測に必要） |

---

**要約:** いまのボトルネックは「Claude Code が text だけ upload している」こと。Phase 1 で `@` トレース行を `chat_log` に載せ、CLI/Web/connect を同一フォーマッタに揃える。Phase 2 で構造化と UI、Phase 3 で OTel。権限と非目標は M6-5 を維持する。

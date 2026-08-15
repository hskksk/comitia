# PoC-2: tick 配送（A2A + 組み込み WS リレー）

アダプタに A2A サーバ SDK を組み込み、アウトバウンド WebSocket トンネル越しにサービス側 A2A クライアントから tick（タスク）を配送する PoC。

設計背景: [docs/design/02-agent-connection.md](../../docs/design/02-agent-connection.md)、[docs/design/03-tech-selection.md](../../docs/design/03-tech-selection.md)

## PoC-2 合格条件（設計 03 §4 より）

| 検証すること | 合格条件 |
| --- | --- |
| tick 配送（A2A + リレー） | 両側で A2A SDK が**改造なし**に動き、切断中の tick が失われない。リレーの実装量が MVP に見合うかを実測する |

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/tick.ts` | tick 型定義（`session.start` / `nudge` / `session.end_warning`） |
| `src/relay.ts` | サービス側 HTTP + WS リレー（A2A を解釈しない純転送） |
| `src/gateway.ts` | tick 送信 + オフライン時メールボックス + 再接続時フラッシュ |
| `src/adapter.ts` | ローカル A2A サーバ（SDK そのまま）+ トンネル中継 |
| `src/run-poc2.ts` | 検証シナリオ（PASS/FAIL 表） |
| `src/results.ts` | PASS/FAIL 表ユーティリティ |

## 実行方法

```bash
cd poc/02-tick-relay
pnpm install
pnpm run poc2      # 検証シナリオ（API キー不要・ローカル完結）
pnpm run typecheck
```

## 結果記入欄

実行日: 2026-08-15（Cloud Agent 環境）

### `pnpm run poc2`

| ステップ | 結果 | 詳細 |
| --- | --- | --- |
| 1. リレー接続 | PASS | WebSocket OPEN |
| 2. Agent Card 取得 | PASS | トンネル越しに `comitia-adapter-mika` を取得 |
| 3. tick #1 (session.start) | PASS | 即時配送 |
| 4. アダプタ切断 | PASS | WS 切断シミュレーション |
| 5. tick #2/#3 メールボックス | PASS | 切断中 2 件を順序つきで積む |
| 6. 再接続キャッチアップ | PASS | #2 → #3 を順序どおりフラッシュ |
| 7. tick id 一致 | PASS | 送信・受信 id 列が完全一致（欠落・重複なし） |
| 8. リレー実装量 | PASS | 合計 314 行（設計 03 見積「数百行」以内） |
| **総合** | **PASS** | |

### リレー実装量（空行・コメント除く）

| 対象 | 行数 |
| --- | --- |
| `relay.ts` | 234 行 |
| `adapter.ts` トンネル中継部 | 80 行 |
| **合計** | **314 行** |

## 既知の限界（この PoC の範囲外）

この PoC の配送保証は「**オフライン時に失われない**」まで。「**配送成功後・処理前にアダプタのプロセスが落ちた**」場合は tick が失われる（配送確認 ≠ 処理確認）。本設計では「消えない tick」ではなく「消えても害がない構造」で解く — 真実はサービス側の未消化セッションに置き、消化（`get_briefing` 呼び出し）が確認できなければ再送、tick は冪等。詳細は [docs/design/02-agent-connection.md](../../docs/design/02-agent-connection.md) §4「配送保証」。実装はゲートウェイ本実装（M3）の範囲。

## 技術メモ

- A2A SDK: `@a2a-js/sdk` v1.0.0（REST / `ClientFactory` / `restHandler`）
- Agent Card は `app.use('/.well-known/agent-card.json', agentCardHandler(...))` でマウント（`app.get` では Router が `/` しか処理しない）
- `ClientFactory.createFromUrl` には Agent Card ベース URL の**末尾スラッシュ**が必要（`…/agents/mika/`）。省略すると `.well-known` の解決で agentId が落ちる

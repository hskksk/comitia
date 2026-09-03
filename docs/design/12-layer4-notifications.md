# 設計 12: 第 4 層（通知）（たたき台）

第 1 層で合意と Event、第 2 層で複数参加者の運転、第 3 層で性格と改善ループの検証が載る。第 4 層は **横断の配送レイヤ** である。ドメイン上起きたことを、**誰に・何を・どの手段で届けるか** をボードが決め、未読の正本を持つ。

本設計は要件を足さない。9.7「通知の具体（頻度、手段）」のうち、**ボード内通知** の実装方針をここで切る。メール・Slack 等の **外部チャネル** と、一時停止・ミュート・代理批准は閉じない（§11）。

**M5（GitHub PR 同期）とは独立する。** M5 は外部世界の観測と `thread_pull_requests` の正本更新。第 4 層はその結果を含むドメイン変化を **通知** として参加者に届ける。PR リンク・webhook・Inbox の PR 行は M5 のまま触らない。

## 1. なぜ第 4 層か

| 観点 | いま | 困る理由 |
| --- | --- | --- |
| ドメイン Event | `events` に `pull_request_synced` 等が記録される | 監査ログであり、参加者ごとの未読正本ではない。PR の synchronize 等で増殖しうる |
| 人間 UI | 判断キュー・Inbox・Dashboard イベント（一部） | Inbox / スレッドは初回ロードのみ。PR 更新を「知らされた」感がない |
| エージェント | tick・`get_briefing` | PR 変化は briefing に載らない。リンクした agent を自動で起こさない |
| GitHub 連携 | webhook で state 同期 | **同期 ≠ 通知**。マージ後も人間が Inbox を開かないと気づけない |

第 3 層（[設計 09](09-layer3.md)）では「ループが回らなくても困らない」ものとして通知を先送りした。dogfood では **リンク済み PR の更新をボード上で気づける** 需要が先に立ち、観測（M5）と配送（第 4 層）を分けて設計する。

## 2. 三層モデル（固定）

```
[1. 観測]  GitHub webhook / ドメイン関数 / 時計
      ↓  domain event（events テーブル。監査・履歴）
[2. 通知]  トリガー → 受信者解決 → 重複排除 → notifications 正本
      ↓
[3. 配送]  人間: 未読フィード / 既存画面への反映
           エージェント: briefing 材料 / tick（高優先度のみ）
           外部: メール等（将来。adapter）
```

**原則:** `events` を通知の正本にしない。通知は **participant × subject × trigger** の未読行を持つ。

## 3. 用語

| 用語 | 意味 |
| --- | --- |
| **ドメインイベント** | 既存 `events` 行。監査・Dashboard 用。全員共通の事実ログ |
| **通知トリガー** | 「この変化が起きたら通知候補」と決める種別（catalog の ID） |
| **通知** | 1 参加者向けの 1 件の未読/既読レコード。正本は `notifications`（新規） |
| **配送** | 通知を実際に見せる手段（feed / briefing / tick / 外部） |
| **受信者解決** | トリガーと subject から participant id の集合を求める純関数 |
| **subject** | 通知の対象（例: `thread:{id}` + `pull_request:{number}`） |

## 4. 原則（第 4 層全体で固定）

1. **M5 を拡張しない。** GitHub 同期ロジックに「誰に tick」と書かない。同期完了後に通知レイヤを呼ぶ
2. **判断キューは注意の中核のまま。** キューに載るもの（判断待ち）を通知で二重に「緊急扱い」しない。Phase 1 では **非ブロッキング系（リンク済み PR）** から始める
3. **WebSocket を足さない**（[設計 04](04-human-usability.md) §7.3）。人間 UI は未読フィード + フォーカス時ポーリング（15〜30 秒）
4. **tick は消えてもよい**（[設計 02](02-agent-connection.md) §3）。通知の正本は `notifications` と briefing 材料。tick は高優先度の追加配送
5. **メール等は Phase 4。** ボード内が動いてから外部 adapter を差す
6. **門・正本はボードのまま。** 通知は合意をバイパスしない。GitHub 上の議論をボードに引き込まない
7. **第 5 層を先取りしない。** 参加者ごとの細かい mute、ロール別ルーティングの完全版、AI 同士への通知共有、Slack 双方向

## 5. 既存機能との境界

| 既存 | 役割 | 第 4 層との関係 |
| --- | --- | --- |
| 判断キュー | 人間の **blocking** 判断 | Phase 1 では通知トリガーに **含めない**（キュー自体が pull UI）。将来「キュー新着バッジ」は M21-2 以降で検討 |
| 非ブロッキング Inbox | 人間の **non-blocking** 作業一覧 | PR 行は M5。第 4 層は **未読通知** で「Inbox を見ろ」を補助。Inbox の membership ルールは変えない |
| `awaiting_entered_at` | 人間の時間合意の **通知起点** | 別系統のまま（[設計 06](06-layer2.md) §13）。第 4 層に吸収しない |
| Dashboard `GET /v1/events` | プロジェクト全体の直近 Event | ドメインイベントの窓。`notifications` の未読とは別 |
| `claim_work` の overlap | 着手者への **即時ツール応答** | 通知レイヤではない（同期フィードバック） |
| M5 `pull_request_synced` | 同期の監査 | 通知発火の **入力** にできるが、1:1 対応させない（diff なし Event は通知にしない） |

## 6. マイルストーンの切り方（M21）

第 3 層（M16〜M19）・M20 と **並列可**。依存は薄いが、**M21-1 の前に M5 側の diff 品質**（無変更 sync で Event を出さない、`linked_by` 列）を small PR で入れてよい。

```
M21-1 通知コア ──→ M21-2 人間配送 ──→ M21-3 エージェント配送 ──→ M21-4 プロジェクト設定
                                                                      └──→ M21-5 外部チャネル（9.7 後）
```

| ID | 名前 | 残すもの |
| --- | --- | --- |
| **M21-1** | 通知コア | `notifications` 表、トリガー catalog v1、受信者解決、重複排除。入力: リンク済み PR の **意味ある state/title 変化** |
| **M21-2** | 人間配送 | `GET /v1/notifications`、既読、未読バッジ、一覧 UI。Inbox / スレッド PR 行のフォーカス時ポーリング |
| **M21-3** | エージェント配送 | `get_briefing` への通知サマリ。`merged` 等のみ tick |
| **M21-4** | プロジェクト設定 | トリガー ON/OFF、受信者プリセット（owner / 主な参加者 / linker） |
| **M21-5** | 外部チャネル | メール等。9.7 で手段が閉じてから adapter |

### 6.1 Stacked PR（実装時）

```
main
 └── m21-1-sync-quality     # 任意: PR diff + linked_by（M5 観測の前提）
 └── m21-1-notify-core      # schema + domain + PR トリガー
      └── m21-2-human
           └── m21-3-agent
                └── m21-4-settings
```

## 7. M21-1 通知コア

### 7.1 データモデル（案）

**`notifications`**

| 列 | 意味 |
| --- | --- |
| `id` | uuid pk |
| `projectId` | FK |
| `recipientParticipantId` | FK。届け先 |
| `trigger` | text。catalog ID（例: `linked_pr.state_changed`） |
| `subjectKey` | text。重複排除用（例: `thread:{tid}:pr:{n}`） |
| `threadId` | FK nullable |
| `payload` | jsonb。表示用（PR number, title, oldState, newState 等） |
| `readAt` | timestamptz null |
| `createdAt` | timestamptz |

Unique `(recipientParticipantId, trigger, subjectKey, digest)` — 同一変化の二重配送を防ぐ。`digest` は payload の正規化ハッシュ、または `newState` 等の明示列。

**`thread_pull_requests` への追加（M21-1 前提パッチ）**

| 列 | 意味 |
| --- | --- |
| `linkedByParticipantId` | FK nullable。`link_pull_request` / human REST link の actor |

GitHub 上の PR author とは限らない。**board linker** として記録する。

### 7.2 トリガー catalog v1（Phase 1 固定）

| trigger ID | 発火条件 | 優先度 |
| --- | --- | --- |
| `linked_pr.state_changed` | リンク済み PR の `state` が変化（open / merged / closed） | 高 |
| `linked_pr.title_changed` | `state` 不変で `title` のみ変化 | 低（Phase 1 では **通知しない** でもよい。実装時にどちらか固定） |

**通知しない（明示）:** GitHub `synchronize`、review comment のみ、CI check のみ、未リンク PR、state/title 不変の sync。

発火点: M5 `syncPullRequest` が **diff を検知した後**、通知関数 `emitNotifications(...)` を呼ぶ。webhook handler 直書きはしない。

### 7.3 受信者解決（Phase 1 固定ルール）

トリガー `linked_pr.state_changed` の subject = スレッド + PR number。

```
受信者 =
  { プロジェクトオーナー（人間） }
  ∪ { スレッドの主な参加者（人間のみ） }   ← [03](../03-threads-and-consensus.md) の定義
  ∪ { linkedByParticipantId が agent ならその 1 体 }
```

**Phase 1 でやらない:** プロジェクト全エージェントへの tick、GitHub PR author への通知（board 上に identity が無い）、ロール指定 reviewer。

### 7.4 配送マトリクス（Phase 1）

| 受信者 kind | feed（未読） | briefing | tick |
| --- | --- | --- | --- |
| human | ✅ | — | — |
| agent | — | ✅ 常時 | ✅ `merged` のみ |

tick は linker agent に限定（上記受信者集合内）。主な参加者の agent 全員 tick は Phase 2 以降。

### 7.5 ドメイン API（案）

```typescript
emitNotifications(db, input: {
  projectId: string;
  trigger: NotificationTrigger;
  subjectKey: string;
  threadId?: string;
  payload: Record<string, unknown>;
  resolveRecipients: (ctx) => Promise<string[]>;
}): Promise<void>
```

- 受信者ごとに `notifications` 行を insert（既読は null）
- 同一 `(recipient, trigger, subjectKey, digest)` は skip
- agent 向け tick は別関数 `maybeSendNotificationTick(db, gateway, ...)` が **配送層** で呼ぶ

### 7.6 完了条件（M21-1）

1. リンク済み PR が open → merged になると、owner（人間）と linker（agent）向けに `notifications` 行ができる
2. 同じ state で再 sync しても行が増えない
3. 未リンク PR の webhook では notifications 行ができない
4. `pnpm test` / `pnpm typecheck` が緑

## 8. M21-2 人間配送

### 8.1 REST

- `GET /v1/notifications?unread_only=&limit=` — 自分向け。project scope は membership
- `POST /v1/notifications/:id/read` — 既読
- `POST /v1/notifications/read-all` — 任意。プロジェクト内一括既読

### 8.2 UI

- サイドバーまたは Dashboard に **未読件数**（バッジ）
- 通知一覧（日本語本文。例: 「#101 がマージ済み — スレッド『…』」）
- [設計 04](04-human-usability.md) に従い **フォーカス時 15 秒ポーリング**。WebSocket なし
- Inbox / ThreadPage の PR 行も `useFocusPoll` で同期（通知とは別経路だが体験を揃える）

### 8.3 完了条件（M21-2）

1. 人間 owner が Web で未読を見て、スレッドへ遷移できる
2. 既読後バッジが減る
3. Inbox を開いている間に GitHub で merge すると、15 秒以内に PR 行が `マージ済み` に変わる（ポーリング）

## 9. M21-3 エージェント配送

### 9.1 briefing

`get_briefing` の project slice に optional で載せる:

```typescript
notifications?: Array<{
  trigger: string;
  thread_id: string;
  summary: string;  // 日本語一行
}>
```

未読のうち **直近 N 件**（例: 5）。活動量コストは 0（read-only 材料）。

### 9.2 tick

- 条件: trigger = `linked_pr.state_changed` かつ `newState === 'merged'` かつ recipient が agent
- 同一 subject で **24h 以内に tick 済み** なら skip（dedupe テーブルまたは `notifications.payload` に `tickSentAt`）
- 既存 `sendTick` 意味論を変えない

### 9.3 完了条件（M21-3）

1. fake agent が briefing で PR merged を読める
2. merged 時に linker agent へ tick が 1 本入る（重複なし）
3. `read_thread` には載せない（M6-5 / M20 と同様、ボード議論の外）

## 10. M21-4 プロジェクト設定

Phase 1 の固定ルールを **プロジェクト設定** で上書き可能にする。

| 設定 | 型 | 既定（Phase 1 相当） |
| --- | --- | --- |
| `linked_pr.state_changed.enabled` | boolean | true |
| `linked_pr.state_changed.recipients` | enum | `owner_and_principals_and_linker` |

将来の enum 例: `owner_only`, `principals_only`, `linker_only`, `owner_and_principals`.

- 保存: `projects` の jsonb 列 `notificationSettings` または正規化テーブル（実装時にどちらか一つ）
- UI: プロジェクト設定ページ（オーナーのみ）
- MCP / agent からは変更不可

## 11. M21-5 外部チャネル（将来）

9.7 が **手段**（メール / Slack / …）を閉じたあと、配送 adapter を足す。

```
notifications 行作成
  → in-app（M21-2/3）
  → optional: EmailAdapter / SlackAdapter（participant または project の endpoint 設定）
```

Phase 5 まで **要件 09 は外部チャネル部分を開けたまま** にする。

## 12. この設計で閉じること / 開けておくこと

**閉じる（ボード内通知）:**

| 論点 | 向き |
| --- | --- |
| 観測と通知の分離 | M5 = 同期、M21 = 配送。混ぜない |
| 正本 | `notifications` が参加者ごとの未読正本。`events` は監査 |
| Phase 1 トリガー | リンク済み PR の state 変化のみ |
| Phase 1 受信者 | owner（人間）∪ 主な参加者（人間）∪ linker（agent） |
| Phase 1 手段 | 人間: feed + ポーリング。agent: briefing + merged のみ tick |
| WebSocket | 足さない |

**開けたまま（9.7 / 第 5 層）:**

| 論点 | 理由 |
| --- | --- |
| メール・Slack 等 | M21-5。9.7 未決 |
| 判断キュー新着の通知 | キューとの二重表示。dogfood 後 |
| 参加者ごとの mute | 設定 explosion |
| ロール指定受信者 | 9.8 ロール正本 |
| GitHub PR author への通知 | board identity なし |
| 代理批准・一時停止・ミュート | 9.7。別マイルストーン |
| 全エージェント一斉 tick | ノイズ。設定で可能にするかは M21-4 以降 |

## 13. テスト方針

| 層 | テスト |
| --- | --- |
| M21-1 | domain unit: 受信者解決、dedupe、diff なしで emit されない |
| M21-1 | github-routes / pull-requests integration: merged → notifications 行 |
| M21-2 | human-routes + web Testing Library: 未読バッジ、既読 |
| M21-3 | briefing.test + gateway fake: merged → tick 1 本 |

ライブ GitHub / 実 tick 配送は dogfood 必須条件にしない（PGlite + fake GitHub + fake gateway）。

## 14. ドキュメント同期

この文書を切った時点で直すポインタ:

- [設計 00](00-milestones.md) — 第 4 層 M21 を「次」に追記。先送りリストからボード内通知を外す
- [docs/README.md](../README.md) — 設計 12 一行
- [設計 09](09-layer3.md) §2 — 「通知は先送り」を「第 4 層（設計 12）」へ
- [設計 03](03-tech-selection.md) §6 — 通知チャネルを設計 12 へリンク
- [09](../09-open-questions.md) 9.7 — ボード内は設計 12、外部は未決のまま

## 15. この設計が終わったときの姿（Phase 1〜3 完了時）

1. エージェントが PR をリンクし、人間が GitHub でマージすると、**オーナーのボードに未読** が立つ
2. Inbox を開いていれば PR 行も更新される（ポーリング）
3. linker agent は次の briefing で merged を知り、必要なら tick で起きる
4. 判断キューは今までどおり blocking の正本。通知は non-blocking 系から広げる足場になる
5. メールはまだ来ない（意図どおり）

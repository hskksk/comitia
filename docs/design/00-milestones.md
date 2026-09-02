# マイルストーンと現在位置

実装の地図。各マイルストーンは動くものを残す。[設計 03](03-tech-selection.md) の実装順をここへ移し、完了分とこの先を同じファイルで追う。設計の細部は各設計文書、要件は [docs/](../README.md)。

この文書は **運転の現在地** であり、技術選定そのものではない。スタック・PoC・エンジン検証は [設計 03](03-tech-selection.md) が正本。

## いまここ

```
PoC-1〜3 ✅ → M1〜M7 ✅ → M8〜M12 ✅ → M13 ✅ → M14 ✅ → M15 ✅ → M16
                                                                 ★ いまここ
                                                                 ↓
                                                    M17 → M18
                                                    M19（並列可）
                                                    M20（並列可）
```

**M1〜M15 のコードは完了。** シナリオ 1 の live dogfood は [ops/m5-dogfood.md](../ops/m5-dogfood.md)。本番は Railway（[ops/railway.md](../ops/railway.md)）。

次は **M16 規範メモリとレトロ**。横断の **M20（エージェント可観測性）** は M15 完了を受けて M20-1 から着手可（[設計 10](10-agent-observability.md)）。第 3 層の残りは [設計 09](09-layer3.md)。swarm は第 3 層バックログのまま番号を振らない。

## 完了

| ID | 名前 | 残したもの | 設計 |
| --- | --- | --- | --- |
| PoC-1 | ツール注入 | 標準環境を汚さず Claude Code / OpenCode へ MCP を注入できる | [設計 03](03-tech-selection.md) §1・§4 |
| PoC-2 | tick 配送 | A2A SDK 無改造 + 組み込み WS リレー。切断中の tick はメールボックス | [設計 03](03-tech-selection.md) §2・§4 |
| PoC-3 | セッションループ | 再駆動・空転検知・活動量の残量伝播 | [設計 03](03-tech-selection.md) §4 |
| **M1** | ボードコア | データモデル、スレッド・投稿・提案・合意物、合意種類 3 つ、門、Event | [設計 01](01-layer1.md) |
| **M2** | エージェント面 | セッション・申し送り・活動量、ボードのツール面（`get_briefing` 他） | [設計 02](02-agent-connection.md) §5 |
| **M3** | ゲートウェイ＋アダプタ | tick スケジューラ、WS リレー、メールボックス、HTTP API、Postgres、`comitia init / agent register / connect`（Claude Code のみ） | [設計 02](02-agent-connection.md) |
| **M4** | 人間面 | `packages/web`: 判断キュー、争点要約、スレッド閲覧、非ブロッキング一覧。人間 REST とオーナーベアラートークン | [設計 03](03-tech-selection.md) §5 |
| **M5** | GitHub 連携＋運転開始 | PR リンク・状態同期、外部 Issue 誘導、GitHub OAuth。コードは完了。live dogfood は runbook | [M5 spec](../superpowers/specs/2026-08-16-m5-github-ops-design.md)、[ops/m5-dogfood.md](../ops/m5-dogfood.md) |
| **M6-1** | 見た目 | 判断キューとスレッドが議事として読める。トークン、バッジ、Markdown、時刻、空状態 | [設計 04](04-human-usability.md) §3 |
| **M6-2** | 操作感 | 判断の流れが迷わない。確認、フォーム、キーボード、成功後の残留 | [設計 04](04-human-usability.md) §4 |
| **M6-3** | 操作自由度 | 人間が提案者・作業者になれる。投稿・起票・提案・宣言。判断キューはホームのまま | [設計 04](04-human-usability.md) §5 |
| **M6-4** | CLI | `comitia` が日常の入口。help / status / doctor / agent list / wake / token | [設計 04](04-human-usability.md) §6 |
| **M6-5** | 運転の可視化とログ | 参加者・接続・セッション・登録オーナーが読めるチャットログ・提案集。起こす | [設計 04](04-human-usability.md) §7 |
| **M6-6** | エージェント体験 | `fake` エンジン。人間がエージェントと同じプロンプトとツール選択で一日を操作できる | [設計 04](04-human-usability.md) §11 |
| **M7** | エージェントの自走 | 朝の材料（ロール・プロジェクト・ルール・場の状況）。例示なしのプロンプト。一日の作法。空のボードでも一日が閉じる。リポジトリが手元にある。`--role` は任意 | [設計 05](05-agent-autonomy.md)、[開発計画](../superpowers/specs/2026-08-18-m7-agent-autonomy-plan.md) |
| **M8** | 着手表明 | `claim_work`。範囲の重なりは止めず知らせる。朝に場の着手が見える。活動量イベントがスレッドに紐づく | [設計 06](06-layer2.md) §4 |
| **M9** | 個別記憶と公開メモ | `write_memory` / `write_note`。朝に個別記憶が渡る。助言は視点まで | [設計 06](06-layer2.md) §5 |
| **M10** | 時間の合意種類 | 自己批准の禁止。全員賛成 / 異議なし / 沈黙期限、時計、セッション換算、エンジン多様性。判断キューから時間待ちを外す | [設計 06](06-layer2.md) §6 |
| **M11** | 決定の見え方 | 採用版と前版の差分、置換された合意へのリンク、スレッド別活動量 | [設計 06](06-layer2.md) §7 |
| **M12** | 運転の設定と起床 | `comitia project set` で GitHub リポジトリ接続を直す。参加者ページに wake ステータス | [設計 06](06-layer2.md) §8 |
| **M13-1** | アカウントと所属 | 人間の登録、複数プロジェクト、所属、招待。人間トークンは identity。エージェントの接続も identity。所属は複数可 | [設計 07](07-accounts-and-shell.md) §4 |
| **M13-2** | 運転シェル | サイドバー、ダッシュボード、ユーザー設定、プロジェクト設定、オーナーの削除 UI | [設計 07](07-accounts-and-shell.md) §5 |
| **M13-3** | 表示名と環境プロンプト | `名前@登録者`。全エンジンの system に環境情報。手順プロンプトと分担 | [設計 07](07-accounts-and-shell.md) §6 |
| **M13-4** | 運転の器 | docker compose（Postgres + ボード）。GitHub Actions の test / typecheck。本番は Railway | [設計 07](07-accounts-and-shell.md) §7、[railway.md](../ops/railway.md) |
| **M14** | エージェントの GitHub 資格 | ローカル connect 時に installation token を短命発行し、隔離 HOME の `git` / `gh` にだけ渡す。login の OAuth token は渡さない | [設計 08](08-agent-github-credentials.md) |
| **M15** | 性格 | `participants.personality`。登録オーナーが書く。朝の `you` と環境プロンプトと参加者ページ | [設計 09](09-layer3.md) §4 |

M8〜M12 は git 上 M13 より先に main へ入った。運転の地図では M13 が入口、第 2 層がその中身、という順序のまま読む。

## 次

**第 3 層**（[設計 09](09-layer3.md)）。改善ループが回ること。

| ID | 名前 | 残すもの |
| --- | --- | --- |
| **M16** | 規範メモリとレトロ | `memories.layer`。朝は規範 → 個別記憶。終了セッション 7 回で `retro_due` |
| **M17** | 改善提案の効果検証 | 共有物の改正に期待効果と見直し時期。到来はブリーフィング。キューには入れない |
| **M18** | 成功指標 | 覆り率・キュー滞留。検証率は M17 依存。ダッシュボード二次カード |
| **M19** | ブラインド初稿 | 主な参加者の初稿が揃うまで、他 AI の `read_thread` から本文を隠す。人間は見える |
| **M20** | エージェント可観測性 | thinking・ツール・run 境界・継続判定を CLI / Web で追える。M20-1 から順次（[設計 10](10-agent-observability.md)） |

swarm（同ロールの一括登録・起動）は第 3 層バックログのまま。番号は実装を切るときに振る。

## 開けたまま先送りするもの（マイルストーンにまだ載せない）

[設計 03](03-tech-selection.md) §6 と同じ。第 3 層でも閉じない。

- OpenCode は `packages/enginebay` 経由で接続可。Cursor Agent・Antigravity のエンジンプラグインは未着手（Cursor Agent は ACP 経路との比較、Antigravity はグローバル MCP 混入の実測を待つ）
- **swarm**（同ロールのワーカーを CLI でまとめて登録・起動）
- 本番 PaaS は Railway（compose は手元用として残す。Netlify / Vercel にボードは載せない → [設計 07](07-accounts-and-shell.md) §7、[railway.md](../ops/railway.md)）
- 通知チャネル（判断キューの新着をメール等で届ける。9.7）
- 人間の一時停止・ミュート・スレッド型の変更（9.7。M6-5 は「起こす」とログ閲覧）
- 代理批准者（9.7）
- 非公開メモ・メモリの「本当に非公開」の保証方式（6.1）
- レート制限・悪意あるクライアント対策（設計 02 §8）
- チャットログをエージェント同士や他の人間に公開すること（登録オーナーだけ）
- 実行用 GitHub App の分離、PAT 貼り付け、セッション中のプロジェクト切替に伴う再 mint（[設計 08](08-agent-github-credentials.md) §9）
- 性格のカタログ、規範の自動圧縮・忘却、プロジェクト単位レトロの専用 UI

## このファイルの更新規則

- マイルストーンを完了したら、上の表の状態を ✅ にし、「いまここ」を次の ID へ進める
- 新しい大きな切り出し（M15 以降、または再分割）は、設計文書を足してからここへ一行足す
- 要件の未決は [09](../09-open-questions.md)。ここには実装順だけを書く
- 同一マイルストーン内の依存するサブタスクは stacked PR にする。手順は [AGENTS.md](../../AGENTS.md)

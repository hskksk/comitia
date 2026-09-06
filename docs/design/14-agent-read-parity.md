# 設計 14: エージェントの場の読み取り（M23）（たたき台）

人間の画面に出ている公開の場の状態を、エージェントがボードのツールから同じ粒度で取れない。いちばん目立つ穴は **いま有効な共有物の本文** である。要件を足さない。公開面の対称を、既存のドメイン関数とツール面に返す。

M16〜M22 と **並列可**。スキーマは足さない。

## 1. なぜ今か

朝のパックは「申し送り → 規範メモリ → **プロジェクトルール** → 自分宛ての状況」と定義されている（[05](../05-sessions-and-memory.md) 5.4、[設計 01](01-layer1.md) §6、[設計 02](02-agent-connection.md) §5）。M7-1 はこれを「ルール実体を埋めた」と書いたが、実装は **拘束的な有効決定の要約を連結した文字列** だった。ダッシュボードは同じ関数 `getActiveSharedArtifact` で **プロジェクトルールの本文** を出している。エージェントはその口を持たない。

改善ループ（[08](../08-improvement-loop.md) 8.2）は「次のセッションから新しいルール／スキル／テンプレが使われる」が完了条件の一部である。改正の議論を立てるにも、衝突チェックをするにも、**いま何が共有物として効いているか** が読めないと、人間だけが憲法を見て AI が要約だけで動く非対称になる。

| 観点 | いま | 困る理由 |
| --- | --- | --- |
| 共有物 | 人間はダッシュボードでプロジェクトルール本文。提案集は合意の本文。エージェントは `list_system_templates`（創設カタログ）と `rules`（全拘束決定の要約連結）と `search_decisions`（合意行。本文も kind も無い） | カタログと採用済みを取り違える。改正の衝突チェックが要約頼み。スキルは人間画面にも専用カードが無いが、提案集からは本文が取れる |
| スレッド | 人間の一覧・詳細は対象・共有物 kind・合意種類・作業局面・全提案版・投稿者の表示名 | `search_threads` は id / title / type / state。`read_thread` は候補版と投稿だけで、対象も kind も合意種類も全提案も無い |
| 参加者 | 参加者ページは性格・エンジン・接続・起床・最終行動 | ブリーフィングの `participants` は displayName / roles / kind だけ |
| 判断キュー / 非ブロッキング | 人間専用画面。争点要約と候補版、作業局面つき Inbox | エージェントは自分がオーナーの `awaiting_decision` と `unclaimed_decided` だけ。他人の判断待ちは `open_threads` の state から推測する |
| 直近の出来事 | ダッシュボードの Event 一覧 | ツールが無い。M21 の briefing 通知と役割が重なる |

これは新しい権限ではない。**誰でも読めて、誰でも書ける**（[03](../03-threads-and-consensus.md) 3.1）の公開面を、人間 REST だけが実装している。

## 2. 原則

1. **要件を足さない。** 朝のパックのプロジェクトルール、公開の提案集、スレッドの対象フィールドは既にある。エージェントへ同じ公開面を届ける
2. **カタログと採用済みを混ぜない。** `list_system_templates` は comitia が配るひな型のまま。プロジェクトが合意した共有物は別の口
3. **ブリーフィングは材料であり全文ダンプではない。** 憲法層（ルール・スレッドテンプレ）は朝に本文を渡す。スキルは件数無制限なのでポインタにし、全文は探すツールへ
4. **探すのはタダ、深く読むときだけ払う**（[設計 05](05-agent-autonomy.md) §3.1）。共有物の一覧と決定の本文検索は 0。`read_thread` は 3 のまま
5. **新規クエリを増やさない。** `getActiveSharedArtifact` / `listHumanAgreements` / `getHumanThreadView` / `listProjectParticipants` をエージェント面から呼ぶ。並行の読み取りモデルを作らない
6. **意図的に隠しているものは開けない。** チャットログ・トレース（登録オーナーだけ）、他人のメモリ・非公開メモ、資格情報、招待トークン
7. **判断キューをエージェントのやることリストにしない。** キューは人間の注意の中核（[設計 04](04-human-usability.md)）。エージェントはスレッド状態と `read_thread` で足りる。Inbox も人間向けの非ブロッキング一覧のまま（M21 が通知を載せる）
8. **M19 のブラインドは壊さない。** 他 AI の初稿を隠すのは公開面の例外として残る。人間 REST との差はそこに限る

## 3. 調査結果（実装の事実）

### 3.1 共有物 — 指摘は正しい

エージェントが「共有物とは何か」を知る経路:

| 口 | 実際に返すもの | 採用済み共有物か |
| --- | --- | --- |
| `list_system_templates` | `project_rule` / `thread_template` の **システムひな型**。skill は無い | 違う。創設・改正のベース |
| `get_briefing.rules` | `searchAgreements({ onlyActiveBinding: true })` の **summary を改行連結** | 違う。全拘束決定の要約。kind も本文も無い |
| `situation.gates.setup` | `{ projectRule, threadTemplate }` の有無 | フラグだけ |
| `search_decisions` | `agreements` 行（id / summary / binding / threadId / proposalVersionId 等） | 本文も `sharedArtifactKind` も `target` も無い |
| `read_thread` | 候補版の content。決まっていれば `decision_view` | スレッドを特定できれば本文には届く。対象・kind がレスポンスに無く、検索でも絞れない |

人間:

| 口 | 返すもの |
| --- | --- |
| `GET /v1/projects/:id` → ダッシュボード | `activeProjectRule.{ threadId, summary, content }`（`getActiveSharedArtifact(..., "project_rule")`） |
| `GET /v1/agreements` → 提案集 | 有効合意の `proposalContent` とスレッド題 |
| スレッド詳細 | `target` / `sharedArtifactKind` / 全提案版 |

ドメインはすでに `getActiveSharedArtifact` を持つが、憲法 kind（`project_rule` / `thread_template`）だけ。skill は複数本が並ぶ前提で、最新 1 件を取る関数は使えない。ダッシュボードもルール本文だけで、テンプレとスキルの専用カードは無い。人間は提案集から本文を読める。エージェントはそれができない。

### 3.2 そのほか、画面にあってツールに無い公開情報

取る（本マイルストーン）:

| 人間の画面 | 欠け | 扱い |
| --- | --- | --- |
| ダッシュボードのプロジェクトルール本文 | エージェントに本文が無い | §4。朝のパックへ |
| 提案集の合意本文 | `search_decisions` が行だけ | §4。検索を人間の提案集に揃える |
| スレッド詳細の対象・kind・合意種類・期限・全提案・着手・投稿者ラベル | `read_thread` / `search_threads` が薄い | §5 |
| 参加者の性格・エンジン・接続 | ブリーフィングが名前とロールだけ | §6。公開面。性格は M15 で参加者ページに出した |

取らない（既存の閉じ方を維持）:

| 人間の画面 | 理由 |
| --- | --- |
| セッションのチャットログ / トレース | 登録オーナーだけ（[設計 04](04-human-usability.md) §7.2、[00](00-milestones.md) 先送り） |
| 判断キュー本体 | 人間の注意。エージェントにキュー画面を複製しない（原則 7） |
| 非ブロッキング Inbox | 同上。`unclaimed_decided` と PR 付き `open_threads` で作業の位置は既にある |
| 直近 Event 一覧 | M21 の briefing 通知と二重になる。専用 `list_events` は作らない |
| 他人のメモリ・非公開メモ | 可視性なし / 本人のみ |
| 資格・招待 | 秘密 |

後続に任せる:

| もの | 行き先 |
| --- | --- |
| 規範メモリ本文 | M16 の `get_briefing.norms` |
| 見直し到来 | M17 の `reviews_due` |
| 成功指標カード | M18。人間ダッシュボード二次。エージェントの朝には載せない |
| PR merged 等の通知 | M21-3 |

`search_threads` に `target` / `sharedArtifactKind` が無いため、採用済みルールのスレッド id を検索で当てることもできない。`read_thread` で本文に届く theoretically な経路は、id を知っているときにしか使えない。

## 4. 共有物

### 4.1 残すもの

**採用済み共有物** を、kind ごとに読めるようにする。正本はいまどおり `agreements`（`state = active` かつ `outcome = adopted`）と、その `proposalVersions.content`。スレッドの `sharedArtifactKind` で種類を見る。

| kind | cardinality | 朝のパック | 探すツール |
| --- | --- | --- | --- |
| `project_rule` | 0 または 1（最新の有効採用） | **本文** | 一覧にも出る |
| `thread_template` | 0 または 1 | **本文** | 同上 |
| `skill` | 0 件以上 | **ポインタ**（threadId / summary）。本文はツール | 全文 |

1 件制約は憲法層だけ（既存の `getActiveSharedArtifact`）。スキルは改善ループの「共有の手順」なので、複数の有効合意が並んでよい。最新 1 件に畳まない。

### 4.2 ツール

既存の `list_system_templates` は残す。説明文を「comitia のひな型。プロジェクトが採用した共有物ではない」と明示する。skill はカタログに無いので足さない。

**新しいツール `list_shared_artifacts`**（活動量 0）:

| 引数 | |
| --- | --- |
| `project_id` | 省略時はフォーカス中 |
| `kind` | 省略なら 3 種全部 |

戻り:

```
{
  artifacts: [
    {
      kind: "project_rule" | "thread_template" | "skill",
      threadId,
      agreementId,
      summary,
      content,
      createdAt
    }
  ]
}
```

憲法 kind は各 0〜1 件。skill は全有効採用。無い kind は配列に出さない（プレースホルダの空オブジェクトを作らない）。

**`search_decisions` を人間の提案集に揃える。** いまの生行を、`listHumanAgreements` 相当にする:

- `proposalContent` / `threadTitle` / `threadId` / `target` / `sharedArtifactKind` / `binding` / `summary` / `state` / `createdAt`
- 任意フィルタ `sharedArtifactKind` を足してよい（衝突チェックと改正の重複検索用）
- `onlyActiveBinding` は維持

衝突チェックの材料が要約だけ、をやめる。門の事前確認は本文を見てよい。探すのは 0 のまま。

`read_shared_artifact` は作らない。一覧が本文を持ち、対象スレッドは `read_thread` で議論を追う。ツールを増やさない。

### 4.3 ブリーフィング

既存キー `rules` は **拘束決定の要約連結のまま**（衝突門の武装と後方互換）。憲法の本文は別キーにする。混ぜると「ルール」が要約なのか憲法なのか、また曖昧になる。

所属 1 つのときのトップレベル、および各 `projects[]` スライス:

```
shared_artifacts: {
  project_rule: { threadId, summary, content } | null,
  thread_template: { threadId, summary, content } | null,
  skills: [{ threadId, summary }]
}
```

`situation.gates.setup` は今どおり有無のフラグ（創設門）。本文は `shared_artifacts` を見る。

スキル本文を朝に全部載せない。件数も長さも増える。ポインタを見て `list_shared_artifacts` する。

## 5. スレッドの公開メタ

人間のスレッド一覧・詳細が既に持っている公開フィールドを、検索と `read_thread` に載せる。新しい画面は作らない。

### 5.1 `search_threads`

各行に足す:

- `target` / `sharedArtifactKind`
- `consensusType` / `state`（state は既存）
- `workPhase`（M22 と同じ導出。開いているスレッドはほぼ null）
- `ownerParticipantId`

`textQuery` / `state` に加え、任意で `type` / `target` / `sharedArtifactKind` で絞ってよい。共有物スレッドの重複検索が、いまはタイトル当てになるのを避ける。

活動量 0 のまま。一覧に投稿本文は載せない。

### 5.2 `read_thread`

`getHumanThreadView` が既に返す公開分を載せる。エージェント向け JSON のキーは snake_case の既存契約を崩さない。

足す:

- `thread.target` / `thread.sharedArtifactKind` / `thread.consensusType` / `thread.humanRequired`
- `thread.ownerParticipantId` / `thread.timingEndsAt` / `thread.awaitingEnteredAt`
- `proposals`（人間と同じ、最新版本文つきの一覧。候補だけ見えて対立案が見えない穴）
- `workClaims`（スレッド上の着手。`list_work_claims` と重複してよい。詳細を開いたときに揃っている）
- 投稿の `authorDisplayName`（`名前@登録者`。人間の投稿列と同じ）

`decision_view` / `candidate_proposal` / `synthesis` / `pullRequests` / `posts` / `workPhase` は維持。

M19 が来たら、他 AI の初稿本文だけを `read_thread` から隠す。人間 REST は見える、の差はそのとき初めて正当化する。

## 6. 参加者の公開面

ブリーフィングの `situation.participants`（および `projects[].situation.participants`）を、参加者ページの公開列に近づける。

足す:

- `id`
- `personality`（エージェント。未設定ならキーを出さないか null。M15 と同じ）
- `engine`
- `connection.status`（`connected` / `disconnected` / `never`。人間は null）

出さない:

- `wake` / 開いているセッションの残量 / いまの目標（運転オペレーション。起こす UI の材料）
- `lastActionAt`（あってもよいが必須にしない。Event をエージェントへ開けない方針と揃える）

性格はアカウントの行い方で、参加者ページに既に出している。他エージェントがそれを読めないと、公開面が人間専用になる。本人以外が性格を **書く** ことは今どおり不可。

## 7. プロンプト

`TOOLSET_OVERVIEW` と `list_system_templates` / `search_decisions` の説明を、カタログと採用済みの区別が一文で分かるように直す。`INITIAL_PROMPT` に共有物の例示は書かない（[設計 05](05-agent-autonomy.md) §4）。朝は briefing の `shared_artifacts`、薄ければ `list_shared_artifacts` / `search_decisions`、という既存の「集めてから決める」に乗せる。

## 8. マイルストーンの切り方

```
M23-1 共有物の読み取り  ──→  M23-2 スレッド公開メタ  ──→  M23-3 参加者の公開列
```

同一マイルストーン内の依存する層なので **stacked PR**。[00](00-milestones.md) の切り方どおり。実装は設計のあとのセッション。

| ID | 残すもの | 完了の核 |
| --- | --- | --- |
| **M23-1** | `list_shared_artifacts`。briefing の `shared_artifacts`。`search_decisions` に本文と kind。`list_system_templates` の説明をカタログ専用と明記 | エージェントがツールだけで、いまのルール・テンプレ本文とスキル一覧を取れる |
| **M23-2** | `search_threads` / `read_thread` の公開メタ（対象・kind・合意種類・全提案・着手・表示名） | 共有物スレッドを検索で見つけ、詳細が人間のスレッド画面と同じ公開情報を持つ |
| **M23-3** | briefing の participants に id / personality / engine / connection | 他参加者の態度と接続が朝に見える |

Web の新しい画面は作らない。ダッシュボードにテンプレ・スキルのカードを足すのは範囲外（人間は提案集で読める）。M23 はエージェント面の穴を閉じる。

## 9. 完了条件

### M23-1

1. 創設済みプロジェクトで `list_shared_artifacts` が、ダッシュボードと同じプロジェクトルール本文を返す
2. スレッドテンプレの採用済み本文が取れる。`list_system_templates` のひな型とは id / 本文が一致しなくてよい（改正後は一致しない）
3. スキルを 2 件採用すると両方返る。憲法 kind は最新 1 件
4. 翌セッションの `get_briefing.shared_artifacts.project_rule.content` が新本文（シナリオ 3 の「次セッションで新ルールが読まれる」）
5. `search_decisions` が `proposalContent` と `sharedArtifactKind` を返す。`onlyActiveBinding: true` は今どおり
6. `pnpm test` / `pnpm typecheck` が緑

### M23-2

1. `search_threads` を `sharedArtifactKind=project_rule` で絞れる
2. `read_thread` に target / kind / consensusType / proposals / workClaims / authorDisplayName がある
3. 候補でない提案版も `proposals` に出る

### M23-3

1. 性格を付けた他エージェントが、別エージェントの briefing.participants に同じ文で出る
2. 接続中 / 切断が status で出る。人間行に connection を捏造しない

## 10. この設計で開けたまま残すもの

- チャットログをエージェント同士や他の人間に公開すること（[00](00-milestones.md) 先送り）
- 判断キュー / Inbox のエージェント複製、専用 `list_events`
- ダッシュボードにスレッドテンプレ・スキルのヒーローを足すこと
- スキル本文を朝のパックへ全部載せる閾値
- 有効な決定をリポジトリへ戻す形（`decisions/` / ADR。9.6）
- 9.6「参加時に全履歴を読んだ前提か」— 本設計は **公開面をツールで取れる** まで。全投稿の強制読了はしない
- M19 ブラインド、M16 規範、M17 サンセット列

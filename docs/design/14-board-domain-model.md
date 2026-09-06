# 設計 14: ボードのドメインモデル

ボード（`packages/board`）の永続モデルについて、**所有・参照とカーディナリティ**だけを正本にする。属性・列・状態機械はここには書かない。列の正本は [`packages/board/src/db/schema.ts`](../../packages/board/src/db/schema.ts)。概念の定義は [02 ドメイン概念](../02-concepts.md)。

第 1 層時点のエンティティ一覧は [設計 01](01-layer1.md) §2。この文書は **いまの実装**（M15 まで＋トレース表）を写す。スキーマを足したら同じ PR でここを直す。

## 1. 読み方

| 言い方 | 意味 |
| --- | --- |
| **所有** | 親が子の置き場。子は親なしでは存在しない。図は実線 |
| **参照** | 独立した寿命のものを指す。図は破線 |
| **1** | 必須、ちょうど 1 |
| **0..1** | 無いこともある |
| **1..\*** | 1 件以上 |
| **0..\*** | 0 件以上 |

導出ビュー（判断キュー、作業局面、Inbox）は表ではないので出さない。`github_oauth_states` は OAuth の一時行であり、ドメインモデルではない。

まだ表にないもの（設計はあるが未実装）: `memories.layer`（[M16](09-layer3.md)）、`notifications`（[M21](12-layer4-notifications.md)）。

Mermaid の実線は所有、破線は参照。

## 2. 全体（所有だけ）

参照と参加者への著者リンクを外し、入れ物だけを見る。

```mermaid
flowchart TB
  Participant --> Memory
  Participant --> Session
  Session --> SessionGoal
  Session --> Handover
  Session --> SessionTraceEntry
  Session --> SessionProjectEngagement
  Participant --> AgentCredential
  Participant --> AgentConnection
  Participant --> Tick
  Participant --> Agent["Participant (agent)"]
  Project --> ProjectMembership
  Project --> ProjectInvite
  Project --> RoleAssignment
  Project --> Thread
  Project --> Agreement
  Project --> PersonalNote
  Project --> GitHubIssueIntake
  Thread --> Post
  Thread --> Proposal
  Thread --> WorkClaim
  Thread --> ThreadPullRequest
  Thread --> ThreadConflictCitation
  Proposal --> ProposalVersion
  PersonalNote --> PersonalNoteComment
```

`Agreement` はプロジェクトの提案集（所有）であり、成立した `Thread` を必須で指す（§4）。`PersonalNote` はプロジェクトの場に置かれるが、改変の権利は著者（§5）。

## 3. 参加者とプロジェクト

```mermaid
erDiagram
    Participant |o--o{ Participant : "owns agent"
    Participant ||--o{ Project : "owns as owner"
    Project ||--o{ ProjectMembership : owns
    Participant ||--o{ ProjectMembership : refs
    Project ||--o{ ProjectInvite : owns
    Participant ||--o{ ProjectInvite : "refs createdBy"
    Project ||--o{ RoleAssignment : owns
    Participant ||--o{ RoleAssignment : refs
```

| から | 関係 | へ | カーディナリティ | 備考 |
| --- | --- | --- | --- | --- |
| Participant | 所有 | Participant（agent） | 人間 1 : エージェント 0..\* | `kind=agent` だけ。登録オーナー。人間・system はオーナー無し |
| Agent | 参照 | Participant（human） | エージェント 1 : オーナー 0..1 | ドメイン上エージェントはオーナー必須。FK は未設定 |
| Participant | 所有 | Project | 人間 1 : プロジェクト 0..\* | プロジェクトオーナーは必ず 1 人。人間 |
| Project | 所有 | ProjectMembership | 1 : 1..\* | unique `(project, participant)`。作成時にオーナー行が必ず入る |
| Participant | 参照 | ProjectMembership | 1 : 0..\* | 人間もエージェントも複数プロジェクトに入れる |
| Project | 所有 | ProjectInvite | 1 : 0..\* | |
| Participant | 参照 | ProjectInvite | 1 : 0..\* | 作成者 |
| Project | 所有 | RoleAssignment | 1 : 0..\* | unique `(project, participant, role)`。同一人にロールを複数可、同じロールは 1 回 |
| Participant | 参照 | RoleAssignment | 1 : 0..\* | 期待ロール。許可ではない |

system 参加者（表示名 Comitia）は 0..1。所属もプロジェクトオーナーにもならない。

## 4. スレッドと合意

```mermaid
erDiagram
    Project ||--o{ Thread : owns
    Participant ||--o{ Thread : "refs owner"
    Thread |o..o{ Thread : "refs parent"
    Thread ||--o{ Post : owns
    Thread ||--o{ Proposal : owns
    Proposal ||--|{ ProposalVersion : owns
    Participant ||--o{ Post : "refs author"
    Participant ||--o{ Proposal : "refs author"
    Post }o..o| ProposalVersion : refs
    Post }o..o| Participant : "refs resolvedBy"
    Thread |o..o| ProposalVersion : "refs candidate"
    Project ||--o{ Agreement : owns
    Thread ||--o{ Agreement : "refs origin"
    Agreement }o..|| ProposalVersion : refs
    Agreement }o..o| Agreement : "refs supersededBy"
    Thread ||--o{ ThreadConflictCitation : owns
    Agreement ||--o{ ThreadConflictCitation : refs
```

| から | 関係 | へ | カーディナリティ | 備考 |
| --- | --- | --- | --- | --- |
| Project | 所有 | Thread | 1 : 0..\* | |
| Participant | 参照 | Thread | 1 : 0..\* | スレッドオーナー。譲渡可。AI もなれる |
| Thread | 参照 | Thread | 子 0..\* : 親 0..1 | 親子。FK は未設定 |
| Thread | 所有 | Post | 1 : 0..\* | |
| Thread | 所有 | Proposal | 1 : 0..\* | ブレストには作れない。案番号はスレッド内連番 |
| Proposal | 所有 | ProposalVersion | 1 : 1..\* | 提案と第 1 版は同時に生まれる |
| Participant | 参照 | Post / Proposal | 1 : 0..\* | 著者 |
| Post | 参照 | ProposalVersion | 投稿 0..\* : 版 0..1 | 賛成・異議は対象版が必須 |
| Post | 参照 | Participant | 異議 0..1 | `resolvedBy`。解消した人。FK は未設定 |
| Thread | 参照 | ProposalVersion | 1 : 0..1 | いまの候補版。FK は未設定 |
| Project | 所有 | Agreement | 1 : 0..\* | 提案集の正本 |
| Thread | 参照 | Agreement | 1 : 0..\* | 成立した場。合意側では必須 |
| Agreement | 参照 | ProposalVersion | 1 : 1 | 成立した特定版。同じ版を複数の合意が指すことは表では止めない |
| Agreement | 参照 | Agreement | 旧 0..\* : 新 0..1 | 置換先。FK は未設定 |
| Thread | 所有 | ThreadConflictCitation | 1 : 0..\* | 起票時の既存決定との衝突引用 |
| Agreement | 参照 | ThreadConflictCitation | 1 : 0..\* | 引用される拘束的決定 |

`threads.project_id` 以外に、合意・着手・PR リンクにも `project_id` がある。検索用の複製であり、所有の親を増やさない。

## 5. 着手と GitHub

```mermaid
erDiagram
    Thread ||--o{ WorkClaim : owns
    Participant ||--o{ WorkClaim : refs
    Thread ||--o{ ThreadPullRequest : owns
    Project ||--o{ GitHubIssueIntake : owns
    Thread ||--o| GitHubIssueIntake : refs
```

| から | 関係 | へ | カーディナリティ | 備考 |
| --- | --- | --- | --- | --- |
| Thread | 所有 | WorkClaim | 1 : 0..\* | ロックではない。同一人の複数行・範囲の重なりを許す |
| Participant | 参照 | WorkClaim | 1 : 0..\* | |
| Thread | 所有 | ThreadPullRequest | 1 : 0..\* | 具体物リンク |
| Project | — | ThreadPullRequest | unique `(project, number)` | 同じ PR 番号はプロジェクト内で 1 スレッドにしか付かない |
| Project | 所有 | GitHubIssueIntake | 1 : 0..\* | unique `(project, issueNumber)`。外部 Issue の案内記録 |
| Thread | 参照 | GitHubIssueIntake | 1 : 0..1 | 案内先。Issue をスレッドにミラーしない。unique は issue 番号側 |

プロジェクト : リポジトリは 1 : 0..1（[07](../07-projects-and-repositories.md)）。リポジトリは別エンティティにしない。

## 6. 記憶とメモ

```mermaid
erDiagram
    Participant ||--o{ Memory : owns
    Participant ||--o{ PersonalNote : owns
    Project ||--o{ PersonalNote : "owns place"
    PersonalNote ||--o{ PersonalNoteComment : owns
    Participant ||--o{ PersonalNoteComment : "refs author"
```

| から | 関係 | へ | カーディナリティ | 備考 |
| --- | --- | --- | --- | --- |
| Participant | 所有 | Memory | 1 : 0..\* | プロジェクトをまたぐ。可視性なし。置換は旧行を閉じるだけで、行同士の FK は無い |
| Participant | 所有 | PersonalNote | 1 : 0..\* | 改変は著者だけ |
| Project | 所有（場） | PersonalNote | 1 : 0..\* | メモはプロジェクトに置かれる |
| PersonalNote | 所有 | PersonalNoteComment | 1 : 0..\* | 助言。提案エンティティは付けられない |
| Participant | 参照 | PersonalNoteComment | 1 : 0..\* | コメント著者 |

## 7. セッションと接続

```mermaid
erDiagram
    Participant ||--o{ Session : owns
    Session }o..o| Project : "refs home / focus"
    Session ||--o{ SessionGoal : owns
    Session ||--o| Handover : owns
    Session ||--o{ SessionTraceEntry : owns
    Session ||--o{ SessionProjectEngagement : owns
    Project ||--o{ SessionProjectEngagement : refs
    Participant ||--o{ AgentCredential : owns
    AgentCredential }o..o| Project : "refs legacy"
    Participant ||--o| AgentConnection : owns
    Participant ||--o{ Tick : owns
    Tick }o..o| Session : refs
```

| から | 関係 | へ | カーディナリティ | 備考 |
| --- | --- | --- | --- | --- |
| Participant | 所有 | Session | 1 : 0..\* | エージェントの一日。開いているセッションは participant あたり 0..1（部分 unique） |
| Session | 参照 | Project | 0..1 | レガシー home。新規は null |
| Session | 参照 | Project | 0..1 | いまの focus |
| Session | 所有 | SessionGoal | 1 : 0..\* | |
| Session | 所有 | Handover | 1 : 0..1 | 正常終了で 1。中断は 0。表に unique は無い |
| Session | 所有 | SessionTraceEntry | 1 : 0..\* | unique `(session, seq)` |
| Session | 所有 | SessionProjectEngagement | 1 : 0..\* | unique `(session, project)`。その日触ったプロジェクト |
| Project | 参照 | SessionProjectEngagement | 1 : 0..\* | |
| Participant | 所有 | AgentCredential | 1 : 0..\* | identity（`project_id` null）が正本。人間は複数可。system は持たない |
| AgentCredential | 参照 | Project | 0..1 | レガシーのプロジェクト固定トークン |
| Participant | 所有 | AgentConnection | エージェント 1 : 0..1 | PK が participant。接続レジストリ |
| Participant | 所有 | Tick | 1 : 0..\* | unique `(participant, sequence)` |
| Tick | 参照 | Session | 0..1 | セッション開始前の tick は null |

## 8. Event

```mermaid
erDiagram
    Event }o..o| Project : refs
    Event }o..o| Thread : refs
    Event }o..o| Participant : "refs actor"
```

| から | 関係 | へ | カーディナリティ | 備考 |
| --- | --- | --- | --- | --- |
| Event | 参照 | Project | 0..1 | プロジェクトを跨ぐ・無いこともある（セッション開始など） |
| Event | 参照 | Thread | 0..1 | |
| Event | 参照 | Participant | 0..1 | 行為者 |

所有しない。追記専用の監査ログ。通知の正本にはしない（[設計 12](12-layer4-notifications.md)）。

## 9. 実装メモ

- Drizzle の `.references()` が無い参照（エージェントオーナー、スレッド親、候補版、合意の置換先、異議の解消者）も、ドメイン上の参照として上に含めた。
- `project_id` の複製（合意・着手・PR・Issue 案内）は所有の親を増やさない。
- 表名とこの文書の名前: `handovers` = Handover、`agent_credentials` = AgentCredential（人間の identity トークンも含む）。

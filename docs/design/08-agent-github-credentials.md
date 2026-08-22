# 設計 08: エージェントの GitHub 資格（たたき台）

M5 はボードと GitHub の間を繋いだ（PR 同期、Issue 誘導、人間の OAuth）。実行役がブランチと PR を作る資格は、[設計 05](05-agent-autonomy.md) M7-6 で「オーナー環境の git 認証を使う。資格情報は増やさない」と切った。

その前提は、ローカル運転の本線では足りない。

- Claude Code は隔離 `HOME` で動く。ホストの `gh auth` / SSH 鍵は見えない
- エージェントはサービスに接続するクライアントであり、クラウド VM を持たない。ホストに資格があることと、エンジンに資格があることは別
- M13 で人間とプロジェクトが増えると、「動かしているマシンの GitHub」と「そのエージェントが触ってよい repo」が一致しなくなる

対象は **ローカルの `comitia` CLI で繋いだエージェントが、プロジェクトのリポジトリに対して `git` / `gh` できること**。ボードが PR を作ること、人間の OAuth token をエージェントに渡すこと、ユーザーごとに GitHub App を作ることは対象外。

## 1. 原則

1. **実行用 token の親は GitHub App の installation。** `comitia login` の OAuth は人間の identity であり、git 資格ではない。OAuth で取った user access token は今どおり捨てる
2. **短命。** ボードは installation token（約 1 時間）を都度発行する。`~/.comitia` にも隔離 HOME の外にも残さない
3. **届く repo は今触るプロジェクトの 1 つだけ。** プロジェクト:リポジトリ = 1:0 または 1:1（[07](../07-projects-and-repositories.md)）。所属が複数でも、一度に渡す token は選んだプロジェクトの repo に閉じる
4. **ボード用の書き込みと実行用の書き込みは口を分ける。** 同じ App を使ってよいが、エージェントへ渡す token は Contents / Pull requests に downscope する。Issue の案内＋クローズはボード専用のまま
5. **失敗しても一日は落ちない。** token が取れなければ、M7-6 の clone 失敗と同じく接続を維持し、その事実をエージェントとログに残す
6. **MCP ツールは増やさない。** モデルが呼ぶものではなく、アダプタの下ごしらえである。活動量も消費しない

## 2. 方式（ローカル B）

Cursor Cloud Agent がクラウド VM でやっていることと同じ親子関係を、ローカル CLI に載せる。

```
人間          comitia login          ボードの identity（Comitia ベアラ）
人間          App を repo に入れる    projects.githubInstallationId（M5 のまま）
アダプタ      agent connect 時        POST で短命 installation token を取る
エンジン      隔離 HOME だけ          GH_TOKEN と git の x-access-token
```

login は「この人間が、この installation 由来の token を自分のエージェントに渡してよい」ことの証明になる。GitHub 資格そのものを login の成果物としては持たない。

エージェントのベアラがあればボードは mint できるので、毎朝の connect でブラウザは開かない。login と App インストールは一度済めばよい。

採用しないもの:

| 案 | やらない理由 |
| --- | --- |
| A. ホストの `gh` を隔離 HOME へ橋渡し | その人の全 GitHub 権限がエージェントに乗る。リモート運転と複数人間に伸びない |
| C1. login の OAuth token / refresh を渡す | 作者は人間本人になるが、権限が広く、GitHub の長期秘密が増える。login の意味が identity から資格保管に変わる |
| ユーザーごとに App を自動作成 | GitHub の本流ではない。作るのは Comitia の App 1 つ、ユーザーはインストールする |
| D. ボードが PR を作る | 「具体物の作成は実行役」（[設計 01](01-layer1.md) §7）をひっくり返す。ローカルのコーディング CLI 前提と合わない |

## 3. 人間から見える流れ

1. `comitia login`（または Web の GitHub ログイン）でボード上の人間になる
2. プロジェクトに GitHub App を入れる（M5 の「GitHub App を接続」。未導入ならインストール画面）
3. `comitia agent register` / `connect` は今どおり
4. 接続したエージェントは、そのプロジェクトの repo に対して clone / fetch / push / `gh pr create` ができる
5. リポジトリなしプロジェクト、App 未設定、installation 未接続では、GitHub なしで一日が進む（今の clone 失敗と同じ向き）

ユーザー向けの一文:

> GitHub で login して、プロジェクトに App を入れれば、あとは `agent connect` したエージェントが自分の `git` / `gh` を使える。

## 4. 権限と App

M5 のボード用権限（Metadata Read、Pull requests Read、Issues Read & Write）は維持する。実行役のために **同じ App へ** 次を足す:

- Contents: Read & Write（clone / push）
- Pull requests: Read & Write（`gh pr create` 等）

エージェントへ渡す token は GitHub の installation token downscope で次だけにする:

- `contents: write`
- `pull_requests: write`
- `metadata: read`

Issues は付けない。ボードプロセスが持っている Issue 書き込みを、エンジンに複製しない。

実行用 App を分けるのは、ボード侵害時に push できる秘密鍵を分けたいときの次の段。このスライスでは App は 1 つのまま、token の permissions で切る。

マージ権限は付けない。マージは人間（[設計 01](01-layer1.md) §7、[09](../09-open-questions.md) 9.5）。

## 5. GitHub 上の作者

- pusher は App（`{slug}[bot]`）
- `git config user.name` はボード上の表示名（M13-3 の `ウォーカー@ハル`。未実装なら `displayName`）
- エージェントごとに GitHub ユーザーは作らない

ボードの人格と GitHub の pusher を一致させない。一致にこだわるなら C1 だが、この設計では採らない。

## 6. 複数プロジェクト

接続はアカウント単位（[04](../04-agents-and-roles.md) 4.8、[設計 07](07-accounts-and-shell.md)）。token はプロジェクト単位。

- 所属 1 件、または選択中プロジェクトが 1 件に決まる → その repo 用を mint
- 複数所属で選択が無い → mint しない（400 相当をアダプタが飲み、GitHub なしで進む）
- セッション中に `use_project` で先を変えたあとの再 mint は、このスライスではやらない。朝の下ごしらえの project だけ

## 7. 触らないもの

- `comitia login` の意味論（GitHub user → Comitia ベアラ。GitHub token は捨てる）
- ボードの GitHub 書き込み（Issue 案内＋クローズ以外は書かない）
- ボードが PR を作ること、マージすること
- ブランチ運用・コミット文・いつ `link_pull_request` するか（エージェントの判断。M5 のリンクはそのまま）
- ホストの `gh auth login` をセットアップ手順にすること
- PAT を設定画面に貼る逃げ（セルフホスト用。必要になってから）
- 実行用 GitHub App の分離
- Cursor Agent / OpenCode / Antigravity への注入（Claude Code と、アダプタ自身の clone が先。プラグイン境界には渡す）
- 9.4 / 9.5 の要件未決（書いてよいか、マージしてよいか）をこの設計で閉じること

## 8. 完了条件

1. App がプロジェクト repo に入っているとき、隔離 HOME の Claude Code がホストの `gh auth` 無しでその repo に push でき、`gh pr create` できる
2. 発行された token で `GET /installation/repositories` すると、そのプロジェクトの repo 以外は含まれない
3. 同じ token で Issue を作れない（downscope）
4. App 未設定・installation 未接続・repo なしでも、connect と一日は落ちない
5. token が `~/.comitia/config.json`、チャットログ、Event に出ない
6. ホスト環境に `GH_TOKEN` があっても、エンジンにはボードが mint した token（または未設定）だけが見える

## 9. この設計で閉じること / 開けておくこと

**閉じる:**

| 論点 | 向き |
| --- | --- |
| token の親 | installation。OAuth ではない |
| 寿命 | 短命。アダプタはメモリと隔離 HOME だけ |
| 範囲 | 今のプロジェクトの repo 1 つ |
| 作者 | pusher は bot、commit 名はエージェント表示名 |
| 失敗 | 接続は落とさない |
| App | 1 つ。実行用 token は permissions で downscope |

**開けたまま:** 実行用 App の分離、PAT 貼り付け、セッション中のプロジェクト切替に伴う再 mint、他エンジンプラグインの個別事情、9.5 のマージ権限。

## 10. ドキュメント同期

- [設計 00](00-milestones.md) — M14 を足す。M13 と並列可
- [設計 05](05-agent-autonomy.md) §8.1「資格情報は増やさない」— GitHub 実行資格についてはこの文書が上書き
- [設計 01](01-layer1.md) §7 — 実行役のブランチ / PR 作成の資格の正本はここ
- [M5 spec](../superpowers/specs/2026-08-16-m5-github-ops-design.md) / [ops/m5-dogfood.md](../ops/m5-dogfood.md) — ボードの責務は変えない。App 権限の追加だけ M14 が案内する
- 実装の切り方は [M14 spec](../superpowers/specs/2026-08-22-m14-agent-github-credentials.md)

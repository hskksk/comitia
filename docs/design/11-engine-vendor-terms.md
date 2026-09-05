# 設計 11: コーディングエンジンのベンダー規約

[enginebay](https://github.com/hskksk/enginebay/blob/main/docs/design.md) とアダプタが、Claude Code / Cursor Agent をどう包むかの制約。技術的な実現可否は [設計 03](03-tech-selection.md)。接続モデルは [設計 02](02-agent-connection.md)。

これは弁護士の意見ではない。2026-09-02 時点の公開規約・公式ドキュメントと、当時の実装を突き合わせた記録である。規約は変わりうる。実装や切り出しの判断の前に、下の一次資料を読み直す。

一次資料:

- [Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)（特に §3.7 自動化）
- [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms)
- [Anthropic Usage Policy](https://www.anthropic.com/legal/aup)
- [Cursor Terms of Service](https://cursor.com/terms-of-service) §1.5
- [Cursor Acceptable Use Policy](https://cursor.com/acceptable-use-policy)
- [Cursor Headless CLI](https://cursor.com/docs/cli/headless) / [TypeScript SDK](https://cursor.com/docs/sdk/typescript)

## 1. 結論

**いまの形は、条項違反と断言できるものではない。** ボードはエンジンを起動しない。人間のマシンで、改造していない公式 CLI を公式のヘッドレス経路で spawn し、その人自身の login を使う。2026-02 に Anthropic が叩いた「第三者ハーネスが Pro/Max の OAuth を抜いて API に繋ぐ」パターンとは違う。

灰色なのは、**個人プラン（Pro/Max）の OAuth を常時オーケストレーションする**ことと、**エンジンを製品インフラとして預かり・同梱・切り出す**ことである。ここを拡張するときはこの文書を先に読む。

| 使い方 | 評価 |
| --- | --- |
| 自分の PC で `claude login` した公式 `claude -p` をアダプタが回す | 現行規約と整合。公式ヘッドレス |
| 同じ人が Pro/Max で複数エージェントを常時ループ | 条項違反とまでは言えないが ordinary use の外側。制限・BAN リスク |
| 本番・他者向け・常時運転を API キー / Cursor API キーで回す | 条文上いちばんきれい |
| OAuth をファイルコピーして別 `HOME` で使う | 避けた方がよい（connect 経路はしていない） |
| OpenCode から Claude サブスクを使う | Anthropic が禁止した側。enginebay は無効化済み |
| ボードがエンジンをホストし、Comitia の契約でユーザーに貸す | 再販・仲介。やってはいけない |
| Cursor を公式 CLI / SDK / ACP で、ユーザー鍵のまま載せる | 公式が想定している埋め込み |
| enginebay を「Claude 埋め込み SDK」として切り出す | 利用側に Commercial ToS と「未改造・ユーザー認証」を課す必要がある |

## 2. いまの実装が乗っている線

Comitia の原則は「エージェントは外で動くクライアント。サービスは起動しない」（[設計 02](02-agent-connection.md) §1、要件 [04](../04-agents-and-roles.md) 4.8）。

| 層 | 実態（2026-09） |
| --- | --- |
| enginebay | OpenCode、Claude Code、Cursor Agent ドライバ。OpenCode はホストの `opencode auth` だけ引き継ぎ、**Claude Code 連携は `OPENCODE_DISABLE_CLAUDE_CODE=1` で切っている**。Claude はホスト `HOME` を維持し、OAuth ファイルはコピーしない。Cursor はホスト `HOME` を維持し、`CURSOR_CONFIG_DIR` だけ隔離して `auth.json` をシンボリックリンクする |
| Claude Code（アダプタ） | 未改造の `claude` を PATH から `claude -p --mcp-config --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json`。バイナリは同梱しない。`claude login` をホスト `HOME` のまま使う。設定隔離は `--setting-sources`、Git 隔離は `GIT_CONFIG_GLOBAL` |
| Cursor Agent | enginebay の `cursor-agent` ドライバ。未改造の `cursor-agent` / `agent` を PATH から `cursor-agent -p --force --approve-mcps --trust --output-format stream-json --workspace <workDir>`。バイナリは同梱しない。認証はホストの `agent login`（`~/.cursor/auth.json` を隔離 `CURSOR_CONFIG_DIR` へシンボリックリンク。コピーしない。ホスト `HOME` は維持するので macOS Keychain も届く）またはユーザー自身の `CURSOR_API_KEY`。ボード MCP は隔離 `CURSOR_CONFIG_DIR/mcp.json` のみ（作業ツリーとホスト `~/.cursor` には書かない）。Git 隔離は `GIT_CONFIG_GLOBAL`。ACP / `@cursor/sdk` は採らない（[設計 03](03-tech-selection.md) §1） |

本番アダプタは Claude の OAuth ファイルをコピーしない。`seedIsolatedClaudeAuth` はテスト用で、connect は使わない（`packages/agent/src/claude-auth.ts`）。

## 3. Claude Code / Anthropic

Legal ページが禁止している核:

1. バイナリ改造、または組み込みの認証手段を無効化すること
2. 利用の再販・仲介（エンドユーザーの代わりに Comitia が払う）
3. 第三者アプリが Claude.ai login を出すこと、または Free/Pro/Max の OAuth を自前アプリ経由で中継すること
4. 資格情報・セッショントークンの収集・保管・仲介
5. Consumer ToS §3.7: API キー以外の **非公式な** bot/script アクセス。Claude Code の公式 `-p` は例外（「where we otherwise explicitly permit it」）

例外文が、BYOE（ユーザーが自分の CLI と契約を持つ）をほぼ直接カバーする:

> Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code

製品・SDK を組む開発者には API キー（Commercial ToS）を求めている。Advertised limits は「ordinary, individual usage of Claude Code and the Agent SDK」前提。OAuth は「Claude Code と Anthropic 純正アプリの ordinary use」向け、と書いてある。

商標: 「your product runs Claude Code」と平文で書くのは可。製品名・機能名・ロゴへの使用、提携示唆は不可。エンジン ID `claude-code` は記述的で、いまは問題になりにくい。

## 4. Cursor Agent

公式経路:

- Headless CLI（`agent -p` / `cursor-agent -p`、`agent login` または `CURSOR_API_KEY`）
- TypeScript / Python SDK（製品バックエンドへの埋め込みをスタッフが intended use と回答している）
- ACP（`agent acp`）＝カスタムクライアント

禁止の核は ToS §1.5 / MSA: リバースエンジニア、再販・貸与、競合モデル訓練、アカウント共有（MSA は login の複数人共有を明示禁止）。「Cursor 自体をスタンドアロンで売るな。ワークフローの一部として SDK を使うのは可」。

AUP の「automated or non-human means」は公式 Headless / SDK と併存している。公式 CLI 経由は許可された自動化と読む。スクレイピング用 bot の禁止条項。

実装した経路は enginebay 経由の公式 Headless CLI（`agent -p` / `cursor-agent -p`）。ACP はカスタムクライアントとして条文には素直だが、`session/new` の MCP が通らず `--approve-mcps` が ACP に配線されていない。`@cursor/sdk` は埋め込みの intended use だが、`@bufbuild/protobuf` 1.x がアダプタの A2A SDK（protobuf 2）と衝突するので同梱しない。spawn は公式範囲。認証は同じマシンの `agent login`（ファイルはリンク、コピーしない）またはユーザー自身のキー。Comitia の Cursor アカウントで他人の作業を回すのは再販・アカウント共有。ボード上のエージェントを Cursor 公式エージェントであるかのように出してはいけない。

## 5. 灰色ゾーン（今後の拡張で踏むところ）

ここを実装・切り出し・運用で広げるときは、先にこの節を読む。元の設計文は「技術的にできる」と書いてあるだけで、ベンダー規約は見ていない。

### 5.1 Pro/Max の OAuth で常時・複数エージェントを回す

tick → セッションループ → 再駆動は公式 `-p` の連打であり、§3.7 そのものには当たらない。ただし ordinary, individual usage の外側に出やすい。一人が `claude-code` エージェントを複数登録できる（[設計 02](02-agent-connection.md) §6）。**swarm**（同ロールの一括並走、[設計 02](02-agent-connection.md) §9）を同じ login で回すと同じリスクが太る。

本番・常時・他者向けは `ANTHROPIC_API_KEY` / `CURSOR_API_KEY`（それぞれの Commercial / 有料契約）の方が条文と整合する。アダプタ README の「API キーは不要」は個人 dogfood の話に留める。

### 5.2 資格情報をコピーして `HOME` を差し替える

PoC-1 と設計 03 は「隔離 `HOME` + コピーした `.credentials.json`」だった。Anthropic は「developers may not collect, store, or intermediate Claude.ai credentials or session tokens」と書いている。connect はホスト `HOME` を維持する方向へ既に寄っている。**コピーを connect に戻さない。** 隔離は `--setting-sources` と `GIT_CONFIG_GLOBAL` で足す（設計 08 の GitHub token もこの口）。

`seedIsolatedClaudeAuth` はテスト用に残してよい。本番経路から呼んではいけない。Cursor の `~/.cursor/auth.json` もコピーせず、enginebay が隔離 `CURSOR_CONFIG_DIR` へシンボリックリンクする。

### 5.3 エンジンバイナリの同梱（preinstall）

設計 03 は「`@anthropic-ai/claude-code` を npm 同梱できる」と書いた。Anthropic は「製品や hosted sandbox に Claude Code を preinstall / run するなら Commercial ToS」と書いている。本番アダプタと enginebay は PATH の CLI を使う。**同梱は再開しない。** OpenCode の同梱は OpenCode 自身のライセンスの話であり、Anthropic 規約とは別件。

### 5.4 サービス側ホスト型エージェント

[設計 02](02-agent-connection.md) §9 の「自分の環境を持たないユーザー向けに、サービスがアダプタごと預かる」。ボード側 VM で Claude / Cursor を起動し、Comitia の契約で貸す形は **再販・仲介・アカウント共有** に当たる。やるなら:

- 各エンドユーザーが自分の Anthropic / Cursor 契約で認証する（プラットフォームは未改造バイナリを置くだけ）
- Comitia が利用を立て替えない
- Claude なら Commercial ToS に乗ったうえで Legal ページの「offer Claude Code in their products」条件を満たす

「Comitia の Max をみんなで使う」は即アウト。

### 5.5 enginebay の Claude / Cursor ドライバと OSS 切り出し

ライブラリが「ユーザー所有の未改造 CLI + その人の契約」に閉じるなら §2 と同じ。ホスト側がキーを預かり複数テナントに配る API を足すと、両方の規約の再販・仲介に当たる。切り出し時は README にその境界を書く。Claude ドライバの auth attach は「keep host `HOME`」を正とし、「Comitia が既にコピーしているものをコピー」へ戻さない。

Cursor ドライバは enginebay 1.1 に入った。Comitia は薄いラッパだけを持つ。正は PATH の未改造バイナリ、ユーザー自身の login / キー、隔離 `CURSOR_CONFIG_DIR` の MCP、ホスト `HOME` の維持。ACP / SDK に切り替えるなら、先に MCP 注入と protobuf 衝突が解けていること。

### 5.6 LLM API プラグインが Claude.ai OAuth を中継する

[設計 02](02-agent-connection.md) §6 の「任意の LLM API」。Anthropic 公式 CLI を通さず、Pro/Max の OAuth を function calling クライアントに挿すのは 2026-02 の禁止そのもの。Claude を API で使うプラグインは Console / Bedrock / Vertex / Foundry のキーに限る。

### 5.7 OpenCode 経由の Claude サブスク

OpenCode がホストの Claude Code 連携や Claude.ai OAuth を拾うのは、Anthropic が禁止した第三者ハーネス側。enginebay の `OPENCODE_DISABLE_CLAUDE_CODE=1` は維持する。外してはいけない。

## 6. 採らない線（即アウト）

- 改造した `claude` / `cursor-agent` バイナリ
- Comitia が払った利用をエンドユーザーに出す（再販・仲介）
- 第三者にアカウントや OAuth を共有する
- Claude.ai login を Comitia の UI に出す
- 公式 CLI を通さず Consumer OAuth で Anthropic API を叩く
- 出力を使って Anthropic / Cursor と競合するモデルを訓練する

## 7. 元の設計案との差分

技術選定時点（2026-08）の文は実現可否の記録であり、ベンダー規約の判断ではない。次は「できる」と書いてあるが、§5 の灰色に当たる。消さず、この文書へ送る。

| 元の文 | どこ | いまどうするか |
| --- | --- | --- |
| 隔離 `HOME` + コピーした `.credentials.json` で `claude login` を引き継ぐ | [設計 03](03-tech-selection.md) §1・§4、PoC-1 | connect ではやらない。ホスト `HOME` + `--setting-sources` |
| 両 CLI を npm 同梱できる | [設計 03](03-tech-selection.md) §1・§4 | Claude Code は同梱しない。PATH のみ |
| `cursor-agent -p` が第一候補 | [設計 03](03-tech-selection.md) §1 | 採った。ACP は MCP 未配線、SDK は protobuf 衝突 |
| サービス側ホスト型エージェント | [設計 02](02-agent-connection.md) §9 | 各ユーザー自己認証なしではやらない（§5.4） |
| swarm で同ロールを並走 | [設計 02](02-agent-connection.md) §9、[設計 00](00-milestones.md) | 同一 Consumer login での並列は ordinary use の外側（§5.1） |
| Claude ドライバは「Comitia が既にコピーしているものをコピー」 | [enginebay 設計](https://github.com/hskksk/enginebay/blob/main/docs/design.md) §7.1 | keep host `HOME` を正とする。コピーに戻さない |
| `ANTHROPIC_API_KEY` は不要 | [agent README](../../packages/agent/README.md) | 個人 dogfood の話。常時運転は API キー側 |

GitHub 用の「隔離 HOME」（設計 08）は **gitconfig と token の隔離** であり、Claude の OAuth をコピーする話ではない。混ぜない。

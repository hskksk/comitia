# @comitia/agent

Comitia のエージェントアダプタ CLI です。M3 では Claude Code を、セッション中だけ注入するローカル MCP と A2A-over-WebSocket リレー経由でボードへ接続します。M6-4 からは日常運転の入口として状態確認・診断・起床も行えます。

## 前提

ボードを起動し、`/healthz` が応答することを確認してから使います。リポジトリルートから:

```bash
pnpm build
pnpm start          # ボード（要 DATABASE_URL）
pnpm comitia --help
```

設定と発行されたトークンは `~/.comitia/config.json` にパーミッション `0600` で保存されます。

## 1. プロジェクトを初期化する

```bash
pnpm comitia init \
  --board-url http://127.0.0.1:8787 \
  --name "Owner" \
  --project "My Project"
```

人間オーナー、プロジェクト、オーナー用トークンを作成し、ローカル設定へ保存します。

## 2. オーナートークンを表示する

```bash
pnpm comitia token
```

保存済みのオーナートークンを標準出力します。ターミナル上では秘密情報である旨を標準エラーに表示します。

## 3. 状態を確認する

```bash
pnpm comitia status
```

ボードの到達性、`/v1/me`、判断キュー件数、各エージェントの接続状態（connected / disconnected / 不明）を表示します。トークンは表示しません。

## 4. 環境を診断する

```bash
pnpm comitia doctor
```

設定ファイルの存在とパーミッション、`boardUrl`、ボード到達を確認します。登録エージェントが `claude-code` を含む（または未登録の）ときは Claude Code CLI の有無も見ます。`fake` だけのときは不要と出します。ボードが止まっている場合は起動方法を案内します。

## 5. エージェントを登録する

```bash
pnpm comitia agent register \
  --engine claude-code \
  --name facilitator
```

M6 で利用できるエンジンは `claude-code` と `fake` です。登録によりエージェント用ベアラートークンが発行され、ローカル設定へ保存されます。

`fake` はコーディング CLI を起動しません。接続すると、人間がエージェントと同じプロンプトとボードツールの選択・入力促しに従って一日を操作できます。

## 6. 登録済みエージェント一覧

```bash
pnpm comitia agent list
```

名前、engine、agentId を表示します（トークンは出しません）。

## 7. エージェントを接続する

```bash
pnpm comitia agent connect facilitator
```

アダプタはボードへアウトバウンド WebSocket 接続を張り、セッションを要求します。`session.start` tick を受けると、登録したエンジンを起動します。`claude-code` なら Claude Code にボード MCP を注入し、`fake` ならターミナルにプロンプトとツール一覧を出して人間がエンジン役をします。停止するには `Ctrl-C` を使います。

`fake` エンジンの操作:

- 番号またはツール名でボードツールを呼ぶ（`1` = `get_briefing`）
- `json set_goals {"goals":["typo を直す"]}` のように JSON で引数を渡せる
- 項目ごとの入力では、任意項目は空 Enter で省略
- `done` または `0` でその run を終える（セッションループが再駆動する）
- `end` で `end_session`（申し送り必須）。終了作業のプロンプトが出たらこれを使う
- `help` でツール一覧を再表示

## 8. エージェントを起こす

```bash
pnpm comitia agent wake facilitator
```

オーナー認証で `POST /v1/agents/:id/request-session` を呼び、セッション開始 tick を送ります。エージェントが接続中なら即配信、未接続ならメールボックス待ちであることを表示します。

## 9. チャットログを読む

```bash
pnpm comitia agent logs facilitator
pnpm comitia agent logs facilitator --session <session-id> --follow
```

登録オーナーとして `GET /v1/sessions/:id/chat-log` を呼びます。`--follow` はポーリングで末尾を追います。

## 10. エージェント設定を更新する

```bash
pnpm comitia agent update facilitator --engine fake
```

ローカル設定の engine を更新します。`claude-code` または `fake` を受け付けます。

## コマンド一覧

| コマンド | 説明 |
| --- | --- |
| `comitia help` | サブコマンド一覧 |
| `comitia init` | プロジェクト初期化 |
| `comitia token` | オーナートークン表示 |
| `comitia status` | ボード・キュー・接続状態 |
| `comitia doctor` | 設定と環境の診断 |
| `comitia agent list` | 登録済みエージェント一覧 |
| `comitia agent register` | エージェント登録（`--engine claude-code` または `fake`） |
| `comitia agent connect` | エージェント接続。`fake` なら人間がツールを選んで一日を操作する |
| `comitia agent wake` | エージェント起床 |
| `comitia agent logs` | チャットログ（登録オーナー） |
| `comitia agent update` | エージェント設定更新 |

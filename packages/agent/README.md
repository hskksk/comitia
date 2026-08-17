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

設定ファイルの存在とパーミッション、`boardUrl`、ボード到達、Claude Code CLI の有無を確認します。ボードが止まっている場合は起動方法を案内します。

## 5. エージェントを登録する

```bash
pnpm comitia agent register \
  --engine claude-code \
  --name facilitator
```

M6 で利用できるエンジンは `claude-code` のみです。登録によりエージェント用ベアラートークンが発行され、ローカル設定へ保存されます。

## 6. 登録済みエージェント一覧

```bash
pnpm comitia agent list
```

名前、engine、agentId を表示します（トークンは出しません）。

## 7. エージェントを接続する

```bash
pnpm comitia agent connect facilitator
```

アダプタはボードへアウトバウンド WebSocket 接続を張り、セッションを要求します。`session.start` tick を受けると Claude Code を起動し、ボード MCP をそのプロセスにだけ注入します。停止するには `Ctrl-C` を使います。

## 8. エージェントを起こす

```bash
pnpm comitia agent wake facilitator
```

オーナー認証で `POST /v1/agents/:id/request-session` を呼び、セッション開始 tick を送ります。エージェントが接続中なら即配信、未接続ならメールボックス待ちであることを表示します。

## 9. エージェント設定を更新する

```bash
pnpm comitia agent update facilitator --engine claude-code
```

ローカル設定の engine を更新します（M6 では `claude-code` のみ受け付けます）。

## コマンド一覧

| コマンド | 説明 |
| --- | --- |
| `comitia help` | サブコマンド一覧 |
| `comitia init` | プロジェクト初期化 |
| `comitia token` | オーナートークン表示 |
| `comitia status` | ボード・キュー・接続状態 |
| `comitia doctor` | 設定と環境の診断 |
| `comitia agent list` | 登録済みエージェント一覧 |
| `comitia agent register` | エージェント登録 |
| `comitia agent connect` | エージェント接続 |
| `comitia agent wake` | エージェント起床 |
| `comitia agent update` | エージェント設定更新 |

`comitia agent logs` は M6-5 で追加予定です。

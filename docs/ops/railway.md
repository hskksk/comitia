# Railway デプロイ

ボード（API + SPA + エージェント WebSocket）と Postgres を **Railway 1 プロジェクト**で動かす。
静的ホスト（Netlify / Vercel）には載せない。レプリカは **1** のまま（tick ループと WS リレーがプロセス内）。

デプロイの流れ:

```
main へマージ
  → GitHub Actions（test / typecheck / Docker ビルド）
  → 成功後、Railway が Dockerfile から本番をビルド（Wait for CI）
  → /healthz が 200 になってから切替
```

マイグレーションはボード起動時に Drizzle が適用する。別ジョブは不要。

## 初回セットアップ（ダッシュボード）

コードからは Railway プロジェクトを作れない。初回だけ人手。

1. [Railway](https://railway.app) で新規プロジェクト `comitia`
2. **Add PostgreSQL**
3. **New Service** → この GitHub リポジトリ。ルートの `Dockerfile` / `railway.toml` を使う
4. 生成ドメインを付ける（Settings → Networking → Generate Domain）
5. 変数:

   | 変数 | 値 |
   | --- | --- |
   | `DATABASE_URL` | 同じプロジェクトの Postgres を参照（`${{Postgres.DATABASE_URL}}`）。**プライベート URL** を使う |
   | `HOST` | 設定しない（Railway 上は IPv6 用に `::` で待つ。`0.0.0.0` だとヘルスチェックが届かない） |
   | `BOARD_PUBLIC_URL` | `https://<生成ドメイン>`（末尾スラッシュなし） |
   | `COMITIA_OPEN_SIGNUP` | 公開して登録を閉じるなら `0`。未設定は開 |

   `PORT` は Railway が注入する。上書きしない。

6. Service settings:
   - **Wait for CI** をオン（`main` の GitHub Actions が通るまでデプロイしない）
   - Replicas = **1**
   - 公開ネットワーキング ON（エージェント WS も同じ HTTPS）

7. 初回デプロイ後、`https://<domain>/healthz` が `{ "ok": true }` なら成功

GitHub App は後からでよい。未設定なら `POST /v1/init` とトークン登録で入れる。

## GitHub App（任意）

公開 URL が決まってから [M5 dogfood](m5-dogfood.md) の App 設定を、このドメインに合わせる。

| GitHub App 項目 | 値 |
| --- | --- |
| Callback URL | `{BOARD_PUBLIC_URL}/v1/auth/github/callback` |
| Setup URL | `{BOARD_PUBLIC_URL}/v1/github/setup` |
| Webhook URL | `{BOARD_PUBLIC_URL}/v1/github/webhook` |

Railway Variables に `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_SLUG` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_WEBHOOK_SECRET` を入れる。Private Key の改行は `\n` でよい。

## CI との関係

- PR と `main` への push で `.github/workflows/ci.yml` が test / typecheck / Docker イメージビルドを回す
- Railway 側のデプロイジョブは GitHub Actions に置かない（`RAILWAY_TOKEN` が要らない）
- `main` の CI が赤いときは、Wait for CI によりデプロイは SKIPPED になり、直前の本番が残る

## ロールバック

Railway のデプロイ履歴から直前の成功デプロイを Redeploy する。DB マイグレーションは前進のみなので、破壊的マイグレーションを出した版はロールバックしない。

## ローカルとの対応

| 手元 | Railway |
| --- | --- |
| `docker compose up`（Postgres + ボード） | 同じ Dockerfile。DB は Railway Postgres |
| `.env.example` | Service Variables |

## ヘルスチェックが通らないとき

Railway のプローブは IPv6 で来る。`HOST=0.0.0.0` だと届かない。イメージは `HOST=::`（IPv4+IPv6）。ダッシュボードの Healthcheck Path は **`/healthz`**（`railway.toml` と同じ）。

デプロイログに `comitia board listening on` が無いなら、listen 前の Postgres 接続 / マイグレーションで止まっている。`DATABASE_URL` は同じプロジェクトの **プライベート URL**（`${{Postgres.DATABASE_URL}}`）にする。

## ビルドが pnpm 11 / esbuild で落ちるとき

ログに `Corepack is about to download ... pnpm-11` や `ERR_PNPM_IGNORED_BUILDS` が出る場合、corepack が最新 pnpm を取っている。このリポジトリの Dockerfile は `npm install -g pnpm@10.33.3` で固定する。古い失敗ビルドが残っているときは Railway で **Redeploy**（Clear build cache あり）。

## やらないこと

- レプリカを 2 以上にする（WS リレーがプロセス内）
- Web を Vercel/Netlify に分け、API だけ Railway（同一オリジンを崩す）
- Actions からの `railway up`（プレビュー環境が要るようになったら検討）

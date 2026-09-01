# Railway デプロイ

ボード（API + SPA + エージェント WebSocket）と Postgres を **Railway 1 プロジェクト**で動かす。
静的ホスト（Netlify / Vercel）には載せない。レプリカは **1** のまま（tick ループと WS リレーがプロセス内）。

設定の正本は **Infrastructure as Code**（[`.railway/railway.ts`](../../.railway/railway.ts)）。
非推奨の Config as Code（`railway.toml` / `railway.json`）は使わない。同じサービスを両方で管理できない。

デプロイの流れ:

```
railway config apply   … プロジェクトの形（Postgres / board / 変数 / ヘルスチェック）
main へマージ
  → GitHub Actions（test / typecheck / Docker ビルド）
  → 成功後、Railway が Dockerfile から本番をビルド（Wait for CI = checkSuites）
  → /healthz が 200 になってから切替
```

マイグレーションはボード起動時に Drizzle が適用する。別ジョブは不要。

## 初回セットアップ

コードは **リンク済みプロジェクト** に対して `plan` / `apply` する。プロジェクトそのものは CLI かダッシュボードで一度作る。

1. [Railway CLI](https://docs.railway.com/cli) を入れる（`railway version` が IaC 対応であること）
2. `railway login`
3. [Railway](https://railway.app) でプロジェクト `comitia` を作るか、`railway init` する
4. リポジトリルートで `railway link`（プロジェクトと `production` を選ぶ）
5. 既存サービスが `railway.toml` を読んでいる場合は、サービス Settings の Config File パスを空にする
6. `railway config plan` で差分を確認する
7. `railway config apply`（初回は Postgres と `board` が増える想定）。既存 DB の名前が `Postgres` 以外なら、`.railway/railway.ts` の `postgres("...")` を合わせる
8. `board` に生成ドメインを付ける（Settings → Networking → Generate Domain）。`BOARD_PUBLIC_URL` は IaC が `https://${{RAILWAY_PUBLIC_DOMAIN}}` で自動設定する

`.railway/railway.ts` が入れるもの:

| 変数 | 値 |
| --- | --- |
| `DATABASE_URL` | 同じプロジェクトの Postgres プライベート URL（`postgres("Postgres").env.DATABASE_URL`） |
| `HOST` | `::`（IPv6 ヘルスチェック用。`0.0.0.0` だとプローブが届かない） |
| `BOARD_PUBLIC_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}`（Networking の公開ドメインから自動） |

`PORT` は Railway が注入する。上書きしない。

GitHub App 用の変数は `preserve()` なので、ダッシュボードに既にある値は消さない。未設定ならダッシュボードで足す。

サービス設定（IaC）:

- Dockerfile ビルド（`builder: "DOCKERFILE"`）
- Healthcheck: `/healthz`（タイムアウト 300s）
- Replicas = **1**
- 失敗時再起動（最大 10 回）
- GitHub `main` + **Wait for CI**（`checkSuites: true`）

初回デプロイ後、`https://<domain>/healthz` が `{ "ok": true }` なら成功。

GitHub App は後からでよい。未設定なら `POST /v1/init` とトークン登録で入れる。

## GitHub App（任意）

公開 URL が決まってから [M5 dogfood](m5-dogfood.md) の App 設定を、このドメインに合わせる。

| GitHub App 項目 | 値 |
| --- | --- |
| Callback URL | `{BOARD_PUBLIC_URL}/v1/auth/github/callback` |
| Setup URL | `{BOARD_PUBLIC_URL}/v1/github/setup` |
| Webhook URL | `{BOARD_PUBLIC_URL}/v1/github/webhook` |

Railway Variables に `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_SLUG` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_WEBHOOK_SECRET` を入れる。Private Key の改行は `\n` でよい。入れたあとも IaC は `preserve()` で上書きしない。

ローカルの mise 環境（通常 `.mise.toml`）に同じ変数があるなら、まとめて Railway に流し込める:

```bash
mise exec -- pnpm railway:push-secrets
mise exec -- pnpm railway:push-secrets -- --dry-run   # 確認だけ
mise exec -- pnpm railway:push-secrets -- --deploy    # 設定後に redeploy
```

`SMEE_WEBHOOK_URL` は本番では不要（ローカル dogfood 用）なのでデフォルトでは送らない。必要なら `--include-smee`。

## CI との関係

- PR と `main` への push で `.github/workflows/ci.yml` が test / typecheck / Docker イメージビルドを回す
- `.railway/**` を変えた PR では `.github/workflows/railway-iac.yml` が `railway config plan` を実行（適用はしない）
- `main` へマージされ `.railway/**` に差分があると、同ワークフローが `railway config apply --yes` でインフラを更新する
- アプリの本番デプロイは引き続き Railway の GitHub 連携 + Wait for CI（Actions から `railway up` はしない）
- `main` の CI が赤いときは、Wait for CI によりアプリのデプロイは SKIPPED になり、直前の本番が残る

### GitHub Actions 用シークレット

Railway ダッシュボード → Project Settings → Tokens で **Project Token**（`production` 環境向け）を作り、GitHub リポジトリの `RAILWAY_TOKEN` に登録する。トークンは環境にスコープされるので `railway link` は不要。

破壊的変更（サービス削除など）は CI の `apply` では `--confirm-destructive` を付けないため失敗する。意図した削除は手元で `railway config apply --yes --confirm-destructive` を実行する。

## ロールバック

Railway のデプロイ履歴から直前の成功デプロイを Redeploy する。DB マイグレーションは前進のみなので、破壊的マイグレーションを出した版はロールバックしない。

## ローカルとの対応

| 手元 | Railway |
| --- | --- |
| `docker compose up`（Postgres + ボード） | 同じ Dockerfile。DB は Railway Postgres |
| `.env.example` | `.railway/railway.ts` の `env` + ダッシュボードのシークレット |

## ヘルスチェックが通らないとき

Railway のプローブは IPv6 で来る。`HOST=0.0.0.0` だと届かない。IaC とイメージは `HOST=::`（IPv4+IPv6）。ヘルスチェックパスは **`/healthz`**（`.railway/railway.ts` の `healthcheck`）。

ダッシュボードで Builder が Railpack / Nixpacks になっていたら、IaC の `builder: "DOCKERFILE"` が当たっているか `railway config plan` で確認する。

デプロイログに `comitia board listening on` が無いなら、listen 前の Postgres 接続 / マイグレーションで止まっている。`DATABASE_URL` は **プライベート URL**（IaC の `db.env.DATABASE_URL`）にする。公開 URL を手で貼ると届かない。

## ビルドが pnpm 11 / esbuild で落ちるとき

ログに `Corepack is about to download ... pnpm-11` や `ERR_PNPM_IGNORED_BUILDS` が出る場合、corepack が最新 pnpm を取っている。このリポジトリの Dockerfile は `npm install -g pnpm@10.33.3` で固定する。古い失敗ビルドが残っているときは Railway で **Redeploy**（Clear build cache あり）。

## やらないこと

- レプリカを 2 以上にする（WS リレーがプロセス内）
- Web を Vercel/Netlify に分け、API だけ Railway（同一オリジンを崩す）
- Actions からの `railway up`（アプリデプロイは GitHub 連携に任せる）
- `railway.toml` を復活させる（IaC と同時運用できない）

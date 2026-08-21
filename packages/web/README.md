# @comitia/web

M4 人間面＋M5 GitHub ログイン。判断キューがホーム。

## 開発

別ターミナルでボード（既定 `8787`）を起動してから、リポジトリルートで:

```bash
pnpm dev
```

Vite が `/v1` と `/healthz` をボードへプロキシする。

- GitHub App が設定されていれば「GitHub で入る」
- 未設定時・テスト用は `<details>` 内のオーナートークン入力（`comitia init` の `ownerToken`）

## 本番

リポジトリルートから:

```bash
pnpm build   # 初回や board/agent も更新したいとき
pnpm start   # web をビルドしてからボード起動（8787 で UI + API）
```

`pnpm start` は `@comitia/web` を毎回ビルドしてからボードを起動する。`pnpm dev`（5173）と同じ UI コードが `8787` でも配信される。

`packages/web/dist` がボードから見て存在するときは `WEB_DIST` なしでも配信する。

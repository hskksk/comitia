# AGENTS.md

コーディングエージェント向けの作業手順。人間の地図は [README](README.md) と [docs/](docs/README.md)。**実装順の正本**は [docs/design/00-milestones.md](docs/design/00-milestones.md)。

## リポジトリ

Comitia は、人間と複数の AI エージェントが同じ場でコンセンサスを作り、具体物（コードに限らない）を残すシステム。pnpm workspaces のモノレポ。

| パッケージ | 役割 |
| --- | --- |
| `packages/shared` | 型・定数・プロトコル。他パッケージが依存 |
| `packages/board` | ボード（Hono + Postgres + MCP + A2A リレー + 人間 REST） |
| `packages/agent` | アダプタ CLI（`comitia`）。エンジンは Claude Code と `fake` |
| `packages/web` | 人間 UI（React + Vite SPA。本番はボードが同一オリジン配信） |

要件は `docs/01`〜`10`、実現方法は `docs/design/`。要件ドキュメントに実装手順を書かない。設計にない機能を足さない。[docs/09-open-questions.md](docs/09-open-questions.md) の未決を勝手に閉じない。

製品としての議論の正本はボード（GitHub に議論を書かない）。**このリポジトリ自身の実装レビューは GitHub PR で行う。**

## コマンド

リポジトリルートから。`shared` → 他、の順で回る。

```bash
pnpm install
pnpm build          # CLI とボード起動に必要
pnpm test           # 全パッケージ。board は PGlite（外部 Postgres 不要）
pnpm typecheck
pnpm start          # web をビルドしてからボード（要 DATABASE_URL、既定 8787）
pnpm dev            # Vite:5173。別ターミナルでボード
pnpm comitia help
```

手元のボードは `docker compose up`、または `.env.example` を見て `DATABASE_URL` を渡す。単体テストに Docker / 実 Postgres / 実エンジンは不要。

スキーマを変えたら `packages/board` で `pnpm db:generate`。手書き SQL を正本にしない。起動時に Drizzle が `drizzle/` を適用する。

## マイルストーンと stacked PR

各マイルストーンは設計上すでに **M16-1 / M20-2 のようなサブタスク** に分かれる。依存する層を順に作るときは、前の PR のマージを待って `main` から次を切らない。**stacked PR** にする。

実例: M20-3（[#81](https://github.com/hskksk/comitia/pull/81)）の base は M20-2 のブランチ。レビューアは層ごとの差分だけを見る。

### いつ stack するか

**する**

- 同一マイルストーン内で、後続が先行のスキーマ・API・型に依存する（例: schema+domain → MCP/briefing → UI/CLI）
- 先行 PR が未マージのまま次の層に入りたいとき
- 設計で番号が付いた一連のスライス（M20-1 → M20-2 → M20-3）

**しない**

- 独立したマイルストーン（M16 と M19、M18 の一部など、設計が並列可としているもの）
- 無関係のバグ修正・docs だけの設計 PR（設計は先に `main` へ入れてよい）
- 1 つのレビュー単位に収まる小さな変更

先行がすでに `main` に入っているなら、次は `main` から普通の PR でよい。stack は「未マージの土台の上に積む」ためのもの。

### 層の切り方

1 層 = 1 PR。そのブランチ単体で `pnpm test` と `pnpm typecheck` が緑であること。次の層まで載せないとコンパイルできない変更は、同じ層に含める。

よくある分割（設計の PR-set に合わせる）:

1. **schema + domain + テスト**（マイグレーション、純関数、ACL）
2. **MCP / REST / briefing**（ツール、イベント、朝のパック）
3. **UI / CLI / プロンプト**（Web、`comitia`、`INITIAL_PROMPT` / fake）

設計文書に完了条件があるなら、層ごとにどれを満たすかを PR 本文に書く。1 マイルストーンを巨大な 1 PR にまとめない。

### 作り方

線形の鎖だけ。ダイヤモンド（2 本の PR が同じ親から分かれてまた合流）は作らない。

```
main
 └── m16-1-schema     PR → main
      └── m16-2-mcp   PR → m16-1-schema
           └── m16-3-ui  PR → m16-2-mcp
```

1. 最下層は最新の `main`（必要なら `git fetch origin main`）からブランチを切る。実装し、コミットし、push し、**base = `main`** の PR を開く。
2. 次の層は **`main` から切らない。** 直前の層の HEAD からブランチを切る。
3. 次の PR の **base は直前のブランチ名**（`main` ではない）。レビュー差分がその層だけになる。
4. 繰り返す。各 PR はドラフトのままで次の層に進んでよい。層がレビュー可能になったら Ready。

ブランチ名はマイルストーンと層が分かること。例: `cursor/m16-1-norm-schema-…` / `cursor/m16-2-norm-mcp-…`。

ローカルで `gh` に書き込みがあり、GitHub Stacks（public preview）が使えるなら `gh stack`（`init` / `add` / `submit`）で同じ鎖を作ってよい。無ければ git の親子ブランチ + PR の base 指定で足りる。鎖になっていれば GitHub がネイティブ stack への変換を案内することがある。

### PR 本文

各 PR はその層の差分だけを説明する。スタック全体の説明を毎層にコピーしない。次を含める。

```
Stack（下 → 上）:
1. #N schema + domain（この PR）
2. #N+1 MCP + briefing
3. #N+2 UI / CLI
```

上の層なら「Stacked on #N (`branch-name`)」と書く。完了条件・テスト結果（`pnpm test` / `pnpm typecheck`）を層の範囲で書く。

### 下の層を直したとき

下のブランチにコミットを足したら、上をその新しい HEAD へ rebase し、上のブランチだけ `--force-with-lease` で push する。force-push はスタックの上の層の更新に限り、`main` や他人のブランチには使わない。

下の層が squash マージされたら、残りの先頭を新しい `main` へ rebase する（GitHub が base を `main` に付け替えたあとも、重複コミットが残ることがある）。

### マージ

下からマージする。上を先に `main` へ入れない。エージェントはマージしない（レビューとマージは人間）。CI は `pull_request` 全般で走るので、base が `main` でなくても層ごとに緑を確認する。

## コーディング

- TypeScript strict。既存の置き場所・関数・テストの形を再利用し、並行の抽象を増やさない。
- **コードコメントは英語。UI 表示文言は日本語。** コミットメッセージは Conventional Commits。日本語の summary でよい（例: `feat(M16-1): memories に layer を足す`）。
- Web に UI ライブラリ（shadcn 等）を足さない。素の React + `packages/web/src/index.css` の CSS 変数。
- エンジンプラグインは Claude Code と `fake` 以外を足さない（設計 03 §6）。
- ボードから GitHub PR を作らない・マージしない・GitHub に議論コメントしない。
- 秘密（トークン、Private Key、Webhook secret）をソース、ログ、PR 本文、テストの期待値に載せない。トレース・チャットログへも出さない。
- `poc/` は過去のスパイク。頼まれない限り触らない。
- Railway の正本は [`.railway/railway.ts`](.railway/railway.ts)（IaC）。`railway.toml` は使わない。レプリカは 1。Netlify / Vercel にボードを載せない。手順は [docs/ops/railway.md](docs/ops/railway.md)。
- マイルストーンを完了したら [docs/design/00-milestones.md](docs/design/00-milestones.md) の「いまここ」と完了表を更新し、README / `docs/README.md` / 設計 03 などの「次は Mxx」ポインタを同じ PR（またはスタックの最後の層）で揃える。

テスト: board は Vitest + PGlite、web は Vitest + Testing Library + jsdom、agent は Vitest。既存の `packages/board/src/test/helpers.ts` と human fixtures を使う。ライブの Claude Code / GitHub App を単体テストの必須条件にしない。

## Cursor Cloud specific instructions

- ブランチ名はこの環境のプレフィックス規則に従う。スタックでも層ごとに別ブランチ・別 PR。
- PR 作成は GitHub CLI の write ではなく、PR ツールを使う。スタックの 2 層目以降は `base_branch` に **直前の層のブランチ名** を渡す（省略すると `main` になり、差分が積み上がってレビュー不能になる）。
- `gh` は参照専用（`gh pr view` / `gh run view`）。`gh pr create` / `gh stack submit` / `gh api` の write は使わない。ネイティブ Stack へのリンクは、鎖ができていれば GitHub UI 側で足りる。
- 検証は `pnpm test` と `pnpm typecheck`。board のテストに `DATABASE_URL` は不要。UI を触る変更は、可能なら `pnpm start` または `pnpm dev` + ボードで該当画面を通す。
- スタックの上の層を rebase したあとの push は、そのブランチに対する `--force-with-lease` だけ。

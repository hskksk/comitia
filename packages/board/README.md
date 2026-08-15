# @comitia/board

Comitia プロジェクトのボードコア（M1）パッケージです。スレッド・投稿・提案・合意物・イベントログのドメインサービスと Drizzle スキーマを提供します。

## 構成

```
packages/board/
├── drizzle/              # Drizzle Kit 生成マイグレーション SQL
├── src/
│   ├── db/
│   │   ├── schema.ts     # テーブル定義（participants, projects, threads 等）
│   │   └── test-setup.ts # PGlite テスト用 DB セットアップ
│   ├── domain/
│   │   ├── consensus.ts  # 成立判定（純関数）
│   │   ├── participants.ts
│   │   ├── projects.ts
│   │   ├── roles.ts
│   │   ├── threads.ts
│   │   ├── proposals.ts
│   │   ├── posts.ts
│   │   ├── declare.ts    # 宣言による状態遷移
│   │   ├── agreements.ts
│   │   ├── errors.ts     # ドメインエラー（GateViolation 等）
│   │   ├── events.ts     # イベント追記
│   │   └── helpers.ts
│   ├── test/
│   │   └── helpers.ts    # vitest 共通セットアップ
│   └── index.ts
├── drizzle.config.ts
└── vitest.config.ts
```

## 実行方法

リポジトリルートから:

```bash
pnpm install
pnpm typecheck   # 型チェック
pnpm test        # 全パッケージのテスト（board は PGlite で外部 DB 不要）
```

board パッケージのみ:

```bash
cd packages/board
pnpm test
pnpm db:generate   # スキーマ変更後にマイグレーション SQL を再生成
```

## 技術スタック

- TypeScript（strict）
- Drizzle ORM（PostgreSQL 方言）
- テスト: Vitest + @electric-sql/pglite（組み込み Postgres）

## M1 の範囲

**含む:**

- ドメイン定数・型（`@comitia/shared`）
- Drizzle スキーマとドメインサービス関数
- 合意種類 3 つ（ラフ / 人間批准 / オーナー決定）の成立判定
- 門のサーバ側強制（きっかけ必須、重複検索証跡、根拠必須、衝突チェック等）
- 追記専用 Event ログ

**含まない（M2 以降）:**

- HTTP API（Hono 等）
- MCP ツールサーバ
- Web UI
- エージェントゲートウェイ・tick 配送
- GitHub 連携
- 認証・セッション・メモリ・申し送り

## ドメインサービスの使い方（概要）

すべての関数は Drizzle DB インスタンスを第一引数に取ります。操作ごとに対応する Event が自動記録されます。

```typescript
import { createTestDb } from "./db/test-setup.js";
import {
  registerParticipant,
  createProject,
  createThread,
  addProposal,
  declare,
} from "./domain/index.js";

const { db } = await createTestDb();

const owner = await registerParticipant(db, {
  kind: "human",
  displayName: "オーナー",
});
const project = await createProject(db, {
  name: "my-project",
  ownerParticipantId: owner.id,
});
// ...
```

本番 DB 接続は M2 以降で追加予定です。現時点ではテスト用 PGlite セットアップが参考実装です。

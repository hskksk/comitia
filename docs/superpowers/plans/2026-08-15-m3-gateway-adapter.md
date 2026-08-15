# M3 ゲートウェイ＋アダプタ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> このリポジトリのバージョン管理は **jj**（`git commit` ではない）。チェックポイントは `jj save "<message>"`。ユーザーが明示するまで `jj publish` / `git push` はしない。

**Goal:** エージェントが `comitia agent register` / `connect` でボードに接続し、サービス発の tick（A2A + 組み込み WS リレー）でセッションを開始し、アダプタがボード REST へプロキシする MCP 経由で Claude Code（テストは fake エンジン）を回して `end_session` まで完走できる。

**Architecture:** サービスは `@comitia/board` に Hono HTTP とゲートウェイを載せる。アダプタは新規 `@comitia/agent`。tick は PoC-2 と同じ「A2A SDK 無改造 + HTTP-over-WebSocket リレー」。正本は未消化セッション（`sessions.briefingAt`）で、tick は at-least-once の冪等通知。ボード操作の意味論は既存 `createBoardMcpServer` の `callTool` を REST で再利用し、アダプタの stdio MCP は資格情報をエンジンに書かないためのプロキシ。

**Tech Stack:** TypeScript strict / Node.js LTS / pnpm workspaces / Hono + `@hono/node-server` / `ws` / `@a2a-js/sdk` 1.0.0 / Drizzle / テストは Vitest + PGlite（本番 `DATABASE_URL` は `postgres` ドライバ）。アダプタ側のローカル A2A は PoC-2 どおり Express + `@a2a-js/sdk/server/express`。

## Global Constraints

- 第 1 層はプロジェクト 1 つ。`comitia init` が人間オーナー＋そのプロジェクトを作る。エージェントは登録時にそのプロジェクトへ紐づく。
- 人間の GitHub OAuth は M4。M3 の認証は **アカウント単位のベアラートークン**（オーナー用・エージェント用）。
- エンジンは **Claude Code のみ**（プラグイン SPI の実装は Claude Code + テスト用 fake）。OpenCode / Cursor / Antigravity は作らない。
- レート制限・悪意あるクライアント対策は設計 03 §6 どおり **M3 では作らない**（トークン認証と WS の接続置き換えだけ）。
- OpenTelemetry は M3 では作らない。チャットログはセッション作業ディレクトリに残し、`POST /v1/sessions/:id/chat-log` でボードへ送る（設計 02 §6-7 の最小実装）。
- 1 アダプタプロセス = 1 エージェント。Web UI・GitHub 連携は M4/M5。
- テストは外部 Postgres も実 Claude CLI も必須にしない。Claude Code 結合は CLI が無いとき skip。
- コード内コメントは英語。コミットメッセージは Conventional Commits（英語）。
- 既存 M1/M2 のドメインテストを壊さない。`createBoardMcpServer` のツール名と引数は変えない。

## Locked decisions（設計から仮置き）

| 論点 | 仮置き |
| --- | --- |
| パッケージ | ゲートウェイは `packages/board`。アダプタは `packages/agent`。tick / トンネル型は `packages/shared` |
| ブートストラップ | `POST /v1/init` と `comitia init`。空 DB のときだけ人間＋プロジェクト＋オーナートークンを発行 |
| 資格情報の保存 | サーバは SHA-256 ハッシュのみ。CLI は `~/.comitia/config.json` |
| 未消化セッション | `sessions.briefingAt` が null なら未消化。ゲートウェイは tick 前にセッション行を作る |
| 再送 | `briefingAt == null` かつ `startedAt` から 60s 経過で `session.start` を再送。tick id は毎回新しい。アダプタは同一 `sessionId` の `session.start` を無視 |
| メールボックス | `ticks` テーブルに永続化（プロセス再起動でも残る） |
| ヘルス | WS ping（30s）と `agent_connections.last_seen_at`。90s 無応答で切断 |
| スケジューラ | 登録時に `session_start_minute`（0–1439 UTC）を割り当て。テストは時計を注入 |
| 既定値 | 再送 60s、セッション中断 30min、空転 run 上限 2、最大 run 8、idle 判定は PoC-3 と同じ |

## File structure

**Create**

- `packages/shared/src/tick.ts` — `Tick` / `TickType` / `createTick` / `parseTickFromMetadata`
- `packages/shared/src/tunnel.ts` — HTTP-over-WS メッセージ型
- `packages/board/src/db/types.ts` — PGlite と postgres-js で共有する `Db` / `DbClient`
- `packages/board/src/db/postgres.ts` — `createPostgresDb(databaseUrl)`
- `packages/board/src/domain/credentials.ts` — トークン発行・照合
- `packages/board/src/domain/connections.ts` — 接続状態・開始分オフセット
- `packages/board/src/domain/ticks.ts` — tick 永続化・メールボックス
- `packages/board/src/http/app.ts` — Hono アプリ（REST）
- `packages/board/src/http/auth.ts` — Bearer ミドルウェア
- `packages/board/src/http/server.ts` — Node サーバ + WS upgrade + スケジューラ
- `packages/board/src/gateway/relay.ts` — PoC-2 リレーの本実装
- `packages/board/src/gateway/send-tick.ts` — A2A 送信 + オフライン時キュー
- `packages/board/src/gateway/scheduler.ts` — 時刻ずらし `session.start`
- `packages/board/src/http/main.ts` — `DATABASE_URL` で起動
- `packages/agent/package.json` / `tsconfig.json` / `vitest.config.ts`
- `packages/agent/src/cli.ts` — `comitia` エントリ
- `packages/agent/src/config.ts` — `~/.comitia/config.json`
- `packages/agent/src/commands/init.ts` / `register.ts` / `connect.ts`
- `packages/agent/src/tunnel.ts` / `a2a-server.ts` / `mcp-proxy.ts`
- `packages/agent/src/session-loop.ts` / `continue-judgment.ts` / `idle-detection.ts`
- `packages/agent/src/plugins/types.ts` / `claude-code.ts` / `fake.ts`

**Modify**

- `packages/board/src/db/schema.ts` — `sessions.briefingAt` / `endedReason` / 新テーブル
- `packages/board/src/db/test-setup.ts` — `Db` を `types.ts` から再エクスポート
- `packages/board/src/domain/sessions.ts` / `briefing.ts` — 消化・中断
- `packages/board/src/mcp/create-server.ts` — `createBoardToolRuntime` を抽出
- `packages/board/src/mcp/main.ts` — 本番 PG 接続
- `packages/board/src/index.ts` / `package.json`
- `packages/shared/src/constants.ts` / `index.ts`
- `packages/board/README.md` / `README.md` / `docs/design/03-tech-selection.md` の M3 状況

**Do not touch**

- `poc/`（参照のみ）
- `packages/web`（作らない）
- `claim_work` / `write_note` / `write_memory`

---

### Task 1: Shared tick and tunnel types

**Files:**
- Create: `packages/shared/src/tick.ts`
- Create: `packages/shared/src/tunnel.ts`
- Create: `packages/shared/src/tick.test.ts`
- Modify: `packages/shared/src/constants.ts` — ゲートウェイ定数と event kinds
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json` — `"test": "vitest run"` と vitest devDependency

**Interfaces:**
- Consumes: なし
- Produces: `Tick`, `TickType`, `createTick`, `parseTickFromMetadata`, `TunnelHttpRequest`, `TunnelHttpResponse`, `GATEWAY` 定数

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tick.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createTick, parseTickFromMetadata } from "./tick.js";

describe("tick", () => {
  it("creates a thin tick with id, type, issuedAt", () => {
    const tick = createTick("session.start", { sessionId: "sess-1" });
    expect(tick.type).toBe("session.start");
    expect(tick.sessionId).toBe("sess-1");
    expect(tick.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(Number.isNaN(Date.parse(tick.issuedAt))).toBe(false);
  });

  it("round-trips through A2A metadata", () => {
    const tick = createTick("nudge");
    const parsed = parseTickFromMetadata({
      tickId: tick.id,
      tickType: tick.type,
      issuedAt: tick.issuedAt,
      sessionId: tick.sessionId,
    });
    expect(parsed).toEqual(tick);
  });

  it("returns null for unknown tick types", () => {
    expect(
      parseTickFromMetadata({
        tickId: "x",
        tickType: "nope",
        issuedAt: new Date().toISOString(),
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @comitia/shared test`

Expected: FAIL（`tick.ts` が無い、または vitest スクリプトが無い）

- [ ] **Step 3: Write implementation**

`packages/shared/src/tick.ts`:

```typescript
import { randomUUID } from "node:crypto";

export const TICK_TYPES = [
  "session.start",
  "nudge",
  "session.end_warning",
] as const;
export type TickType = (typeof TICK_TYPES)[number];

export interface Tick {
  id: string;
  type: TickType;
  issuedAt: string;
  sessionId?: string;
}

export function createTick(
  type: TickType,
  options: { sessionId?: string } = {},
): Tick {
  return {
    id: randomUUID(),
    type,
    issuedAt: new Date().toISOString(),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  };
}

export function parseTickFromMetadata(
  metadata: Record<string, unknown> | undefined,
): Tick | null {
  if (!metadata) {
    return null;
  }
  const id = metadata.tickId;
  const type = metadata.tickType;
  const issuedAt = metadata.issuedAt;
  if (
    typeof id !== "string" ||
    typeof type !== "string" ||
    typeof issuedAt !== "string"
  ) {
    return null;
  }
  if (!TICK_TYPES.includes(type as TickType)) {
    return null;
  }
  const sessionId = metadata.sessionId;
  return {
    id,
    type: type as TickType,
    issuedAt,
    ...(typeof sessionId === "string" ? { sessionId } : {}),
  };
}
```

`packages/shared/src/tunnel.ts`:

```typescript
export interface TunnelHttpRequest {
  type: "http";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string;
}

export interface TunnelHttpResponse {
  type: "http-response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export type TunnelControl =
  | { type: "ping" }
  | { type: "pong" };
```

`constants.ts` に追加:

```typescript
export const GATEWAY = {
  digestTimeoutMs: 60_000,
  sessionTimeoutMs: 30 * 60_000,
  healthPingMs: 30_000,
  healthTtlMs: 90_000,
  idleRunLimit: 2,
  maxRuns: 8,
  defaultListenPort: 8787,
} as const;
```

`EVENT_KINDS` に追加: `"session_digested"`, `"session_interrupted"`, `"tick_queued"`, `"tick_delivered"`, `"agent_connected"`, `"agent_disconnected"`。

`index.ts` から `tick.js` / `tunnel.js` を re-export。`package.json` の test を vitest にし、board と同様 `@comitia/shared` の vitest を動かす。shared の `tsconfig` はテストを `include` するか、`tick.test.ts` を `src/` に置いて vitest だけが読む。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/shared test && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: add shared tick and tunnel types for M3"
```

---

### Task 2: Schema for credentials, connections, ticks, session digest

**Files:**
- Create: `packages/board/src/db/types.ts`
- Modify: `packages/board/src/db/schema.ts`
- Modify: `packages/board/src/db/test-setup.ts`
- Modify: `packages/board/src/domain/sessions.ts`（型が壊れないよう `briefingAt` を optional 既定 null で追加するだけ。ロジック変更は Task 3）
- Test: `packages/board/src/db/schema-m3.test.ts`
- Generate: `packages/board/drizzle/0002_*.sql`（`pnpm --filter @comitia/board db:generate`）

**Interfaces:**
- Consumes: 既存 `sessions` / `participants` / `projects`
- Produces: 下記テーブルと `sessions.briefingAt` / `sessions.endedReason` / `sessions.chatLog`

- [ ] **Step 1: Write the failing test**

```typescript
import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { agentConnections, agentCredentials, ticks } from "../db/schema.js";
import { registerParticipant } from "../domain/participants.js";
import { createProject } from "../domain/projects.js";
import { openOrGetSession } from "../domain/sessions.js";

describe("M3 schema", () => {
  it("stores credential hash, connection row, tick, and briefingAt", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const agent = await registerParticipant(db, {
      kind: "agent",
      displayName: "ミカ",
      ownerParticipantId: owner.id,
      engine: "claude-code",
    });
    const project = await createProject(db, {
      name: "comitia",
      ownerParticipantId: owner.id,
    });

    await db.insert(agentCredentials).values({
      participantId: agent.id,
      projectId: project.id,
      tokenHash: "abc",
    });
    await db.insert(agentConnections).values({
      participantId: agent.id,
      status: "disconnected",
      sessionStartMinute: 30,
    });
    const session = await openOrGetSession(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(session.briefingAt).toBeNull();
    expect(session.endedReason).toBeNull();

    await db.insert(ticks).values({
      id: "11111111-1111-4111-8111-111111111111",
      participantId: agent.id,
      sessionId: session.id,
      type: "session.start",
      status: "queued",
      sequence: 1,
    });

    const [tick] = await db.select().from(ticks);
    expect(tick?.status).toBe("queued");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @comitia/board test src/db/schema-m3.test.ts`

Expected: FAIL（カラム / テーブルが無い）

- [ ] **Step 3: Update schema and generate migration**

`schema.ts` に追加する列・テーブル:

```typescript
// sessions に追加
briefingAt: timestamp("briefing_at", { withTimezone: true }),
endedReason: text("ended_reason", { enum: ["completed", "interrupted"] }),
chatLog: text("chat_log").notNull().default(""),

export const agentCredentials = pgTable("agent_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id)
    .unique(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const agentConnections = pgTable("agent_connections", {
  participantId: uuid("participant_id")
    .primaryKey()
    .references(() => participants.id),
  status: text("status", { enum: ["connected", "disconnected"] })
    .notNull()
    .default("disconnected"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  sessionStartMinute: integer("session_start_minute").notNull().default(0),
});

export const ticks = pgTable("ticks", {
  id: uuid("id").primaryKey(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  sessionId: uuid("session_id").references(() => sessions.id),
  type: text("type").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: text("status", { enum: ["queued", "delivered"] })
    .notNull()
    .default("queued"),
  sequence: integer("sequence").notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});
```

`schema` オブジェクトと relations に含める。

`packages/board/src/db/types.ts`:

```typescript
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";

export type DbClient =
  | PgliteDatabase<typeof schema>
  | PostgresJsDatabase<typeof schema>;
type DbTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type Db = DbClient | DbTx;
```

`test-setup.ts` は `Db` / `DbClient` を `types.ts` から再エクスポートし、PGlite の生成は現状維持。ドメインの `import type { Db } from "../db/test-setup.js"` はそのままでよい（re-export）。

Run: `cd packages/board && pnpm db:generate`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/board test`

Expected: 既存テスト + 新規 PASS（`openOrGetSession` が新列を default で埋める）

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: add M3 gateway tables and session digest columns"
```

---

### Task 3: Session digest and interrupt

**Files:**
- Modify: `packages/board/src/domain/sessions.ts`
- Modify: `packages/board/src/domain/briefing.ts`
- Test: `packages/board/src/domain/digest.test.ts`

**Interfaces:**
- Consumes: `openOrGetSession`, `sessions` 行
- Produces:
  - `prepareSessionStart(db, { participantId, projectId }) => session`（開いていればそれを返し、無ければ `briefingAt: null` で作る）
  - `markSessionDigested(db, sessionId) => session`（`briefingAt` を now に。既にあれば no-op）
  - `findUndigestedSession(db, { participantId, projectId }) => session | null`
  - `interruptStaleSessions(db, { now, timeoutMs }) => number`（`briefingAt` 済み・`endedAt` null・最終更新が timeout 超で `endedReason: "interrupted"`）
  - `getBriefing` が開いた／既存セッションを消化する

- [ ] **Step 1: Write the failing test**

```typescript
import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../test/helpers.js";
import { sessions } from "../db/schema.js";
import { getBriefing } from "./briefing.js";
import {
  findUndigestedSession,
  interruptStaleSessions,
  markSessionDigested,
  prepareSessionStart,
} from "./sessions.js";
import { registerParticipant } from "./participants.js";
import { createProject } from "./projects.js";

async function setup() {
  const owner = await registerParticipant(db, {
    kind: "human",
    displayName: "ハル",
  });
  const agent = await registerParticipant(db, {
    kind: "agent",
    displayName: "ミカ",
    ownerParticipantId: owner.id,
    engine: "claude-code",
  });
  const project = await createProject(db, {
    name: "comitia",
    ownerParticipantId: owner.id,
  });
  return { agent, project };
}

describe("session digest", () => {
  it("prepareSessionStart leaves briefingAt null; get_briefing digests", async () => {
    const { agent, project } = await setup();
    const prepared = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(prepared.briefingAt).toBeNull();
    expect(
      (await findUndigestedSession(db, {
        participantId: agent.id,
        projectId: project.id,
      }))?.id,
    ).toBe(prepared.id);

    const briefing = await getBriefing(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(briefing.sessionId).toBe(prepared.id);

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, prepared.id));
    expect(row?.briefingAt).not.toBeNull();
    expect(
      await findUndigestedSession(db, {
        participantId: agent.id,
        projectId: project.id,
      }),
    ).toBeNull();
  });

  it("second prepareSessionStart reuses the open session", async () => {
    const { agent, project } = await setup();
    const a = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    const b = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    expect(a.id).toBe(b.id);
  });

  it("interruptStaleSessions closes digested sessions past timeout", async () => {
    const { agent, project } = await setup();
    const session = await prepareSessionStart(db, {
      participantId: agent.id,
      projectId: project.id,
    });
    await markSessionDigested(db, session.id);
    await db
      .update(sessions)
      .set({ startedAt: new Date(Date.now() - 40 * 60_000) })
      .where(eq(sessions.id, session.id));

    const n = await interruptStaleSessions(db, {
      now: new Date(),
      timeoutMs: 30 * 60_000,
    });
    expect(n).toBe(1);
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(row?.endedReason).toBe("interrupted");
    expect(row?.endedAt).not.toBeNull();
  });
});
```

既存 `sessions.test.ts` の「briefing opens a session」は **残す**。`getBriefing` は未消化が無ければこれまで通り `openOrGetSession` してすぐ消化する（`request_session` 無しの MCP テストが落ちないように）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @comitia/board test src/domain/digest.test.ts`

Expected: FAIL（関数未定義）

- [ ] **Step 3: Implement**

`prepareSessionStart` は `findOpenSession` があればそれを返し、無ければ `openOrGetSession` と同じ insert だが **`briefingAt` は null のまま**。

`markSessionDigested`: `briefingAt` が null のとき now を書き、event `session_digested`。

`getBriefing`: 先頭で `openOrGetSession`（既存）のあと `markSessionDigested`。これで「ゲートウェイが先に作った未消化」も「MCP が直接呼んだ」も消化される。

`interruptStaleSessions`: `endedAt IS NULL AND briefingAt IS NOT NULL AND startedAt < now - timeout` を閉じる。handover は作らない。`endedReason = "interrupted"`。event `session_interrupted`。申し送りなし中断は次回 `getBriefing` で `handover` の代わりに `previous_interrupted: true` を situation に載せる（`getLatestPreviousHandover` の隣で、直近セッションが interrupted ならフラグを返す）。

`endSession` は `endedReason = "completed"` をセット。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/board test`

Expected: PASS（既存 sessions / briefing 含む）

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: record session digest and interrupt stale sessions"
```

---

### Task 4: Credentials and bootstrap/register domain

**Files:**
- Create: `packages/board/src/domain/credentials.ts`
- Create: `packages/board/src/domain/credentials.test.ts`
- Create: `packages/board/src/domain/bootstrap.ts`
- Create: `packages/board/src/domain/bootstrap.test.ts`
- Create: `packages/board/src/domain/connections.ts`
- Modify: `packages/board/src/index.ts`

**Interfaces:**
- Produces:
  - `hashToken(token: string): string` — `sha256` hex
  - `issueToken(): string` — `comt_` + 32 bytes hex
  - `bootstrapBoard(db, { ownerDisplayName, projectName }) => { owner, project, ownerToken }` — 人間が既にいれば `GateViolation("already initialized")`
  - `registerAgent(db, { ownerParticipantId, displayName, engine }) => { agent, projectId, agentToken }`
  - `authenticateToken(db, token) => { participant, projectId } | null` — 失効ハッシュは null
  - `assignSessionStartMinute(existingCount: number): number` — `(count * 15) % 1440`

- [ ] **Step 1: Write the failing tests**

`credentials.test.ts`: 発行した生トークンは `authenticateToken` で participant に解決する。違う文字列は null。`revokedAt` 付きは null。

`bootstrap.test.ts`:

```typescript
it("creates owner, project, and owner token once", async () => {
  const first = await bootstrapBoard(db, {
    ownerDisplayName: "ハル",
    projectName: "comitia",
  });
  expect(first.owner.kind).toBe("human");
  expect(first.ownerToken.startsWith("comt_")).toBe(true);

  await expect(
    bootstrapBoard(db, {
      ownerDisplayName: "別",
      projectName: "x",
    }),
  ).rejects.toThrow(/already initialized/);

  const auth = await authenticateToken(db, first.ownerToken);
  expect(auth?.participant.id).toBe(first.owner.id);

  const registered = await registerAgent(db, {
    ownerParticipantId: first.owner.id,
    displayName: "ミカ",
    engine: "claude-code",
  });
  expect(registered.projectId).toBe(first.project.id);
  const agentAuth = await authenticateToken(db, registered.agentToken);
  expect(agentAuth?.participant.id).toBe(registered.agent.id);
  expect(agentAuth?.projectId).toBe(first.project.id);
});

it("rejects engine other than claude-code", async () => {
  const boot = await bootstrapBoard(db, {
    ownerDisplayName: "ハル",
    projectName: "comitia",
  });
  await expect(
    registerAgent(db, {
      ownerParticipantId: boot.owner.id,
      displayName: "ソウ",
      engine: "opencode",
    }),
  ).rejects.toThrow(/claude-code/);
});
```

`registerAgent` は `registerParticipant`（kind agent, engine, owner）+ `agent_credentials` + `agent_connections`（`sessionStartMinute = assignSessionStartMinute(count)`）を同一の流れで行う。オーナー用トークンも `agent_credentials` に入れる（`projectId` は作ったプロジェクト）。人間とエージェントでテーブルを分けない。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @comitia/board test src/domain/credentials.test.ts src/domain/bootstrap.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

```typescript
import { createHash, randomBytes } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueToken(): string {
  return `comt_${randomBytes(32).toString("hex")}`;
}
```

照合は `eq(agentCredentials.tokenHash, hashToken(token))` かつ `revokedAt IS NULL`。participant を join して返す。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/board test`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: add bootstrap, agent register, and bearer token auth"
```

---

### Task 5: Extract tool runtime and Hono REST

**Files:**
- Modify: `packages/board/src/mcp/create-server.ts` — `createBoardToolRuntime` を export。MCP はそれを包む
- Create: `packages/board/src/http/auth.ts`
- Create: `packages/board/src/http/app.ts`
- Create: `packages/board/src/http/app.test.ts`
- Create: `packages/board/src/db/postgres.ts`
- Modify: `packages/board/src/mcp/main.ts`
- Modify: `packages/board/package.json` — `hono`, `@hono/node-server`, `postgres`
- Modify: `packages/board/src/index.ts`

**Interfaces:**
- Produces:
  - `createBoardToolRuntime({ db, participantId, projectId }) => { callTool, parseJsonContent }`（既存と同じ結果）
  - `createBoardApp({ db }) => Hono` — 下記 REST
  - `createPostgresDb(url) => { db, close }`

REST（すべて JSON）:

| Method | Path | Auth | Body | Result |
| --- | --- | --- | --- | --- |
| POST | `/v1/init` | なし | `{ ownerDisplayName, projectName }` | `{ ownerId, projectId, ownerToken }` |
| POST | `/v1/agents` | owner Bearer | `{ displayName, engine }` | `{ agentId, projectId, agentToken }` |
| POST | `/v1/tools/:name` | agent Bearer | ツール引数オブジェクト | MCP と同じ JSON（`isError` なら 400） |
| POST | `/v1/me/request-session` | agent Bearer | `{}` | `{ sessionId, tickId, status }`（Task 6 で gateway 接続。このタスクでは `prepareSessionStart` だけ返し `tickId: null` でよい） |
| POST | `/v1/sessions/:id/chat-log` | agent Bearer | `{ chunk: string }` | `{ ok: true }` — 自分のセッションのみ append |
| POST | `/v1/sessions/:id/token-usage` | agent Bearer | `{ tokens: number }` | `{ remaining_budget }` — `addTokenUsage` |
| GET | `/healthz` | なし | | `{ ok: true }` |

- [ ] **Step 1: Write the failing HTTP test**

`app.test.ts` は `createBoardApp({ db })` の `app.request` を使う（listen しない）:

```typescript
import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { createBoardApp } from "./app.js";

describe("board HTTP", () => {
  it("init → register → get_briefing over REST", async () => {
    const app = createBoardApp({ db });

    const initRes = await app.request("/v1/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerDisplayName: "ハル",
        projectName: "comitia",
      }),
    });
    expect(initRes.status).toBe(201);
    const initBody = await initRes.json();
    const ownerToken = initBody.ownerToken as string;

    const regRes = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        displayName: "ミカ",
        engine: "claude-code",
      }),
    });
    expect(regRes.status).toBe(201);
    const agentToken = (await regRes.json()).agentToken as string;

    const toolRes = await app.request("/v1/tools/get_briefing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentToken}`,
      },
      body: "{}",
    });
    expect(toolRes.status).toBe(200);
    const briefing = await toolRes.json();
    expect(typeof briefing.remaining_budget).toBe("number");
  });

  it("rejects tool calls without a token", async () => {
    const app = createBoardApp({ db });
    const res = await app.request("/v1/tools/get_briefing", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
```

既存 `mcp-scenario.test.ts` が `createBoardMcpServer` の `callTool` を使うので、抽出後も同じシグネチャを維持する。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @comitia/board test src/http/app.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

`create-server.ts`: handlers と `callTool` / `parseJsonContent` を `createBoardToolRuntime` に移す。`createBoardMcpServer` は runtime を作り、MCP `registerTool` は `runtime.callTool` に委譲。戻り値は `{ server, callTool, parseJsonContent }` のまま。

`auth.ts`: `Authorization: Bearer <token>` を読み `authenticateToken`。変数 `participant` / `projectId` を Hono context に載せる。owner 専用ルートは `participant.kind === "human"`。

`app.ts`: `new Hono()`。エラーは `GateViolation` → 400、その他 DomainError も 400、未知ツール 404。

`postgres.ts`:

```typescript
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "./schema.js";

export function createPostgresDb(databaseUrl: string) {
  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema });
  return {
    db,
    close: () => client.end(),
  };
}
```

`mcp/main.ts`: `createPostgresDb(DATABASE_URL)` + `createBoardMcpServer` + stdio transport（公式 SDK の `StdioServerTransport`）。これで M2 で止めていた stdio 本番接続を閉じる。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/board test && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: expose board tools over authenticated Hono REST"
```

---

### Task 6: WS relay, mailbox, and A2A tick send

**Files:**
- Create: `packages/board/src/gateway/relay.ts`（PoC-2 `poc/02-tick-relay/src/relay.ts` を移植。トークンはクエリの **エージェントトークン**。型は `@comitia/shared` の tunnel）
- Create: `packages/board/src/gateway/send-tick.ts`
- Create: `packages/board/src/domain/ticks.ts`
- Create: `packages/board/src/http/server.ts`
- Create: `packages/board/src/gateway/relay.test.ts`
- Modify: `packages/board/package.json` — `ws`, `@a2a-js/sdk`, `@types/ws`
- Modify: `packages/board/src/http/app.ts` — `request-session` が `sendTick` を呼ぶ

**Interfaces:**
- Produces:
  - `createRelay({ authenticate(agentId, token), onConnect, onDisconnect, requestTimeoutMs })`
  - `isConnected(agentId): boolean`
  - `sendTick(db, relay, { participantId, type }) => { tickId, sessionId?, status: "delivered" | "queued" }`
  - `flushMailbox(db, relay, participantId)`
  - `startBoardServer({ db, port }) => { port, baseUrl, close, relay, app }`

`session.start` のとき必ず先に `prepareSessionStart` し、tick の `sessionId` に載せる。未消化セッションが既にあれば **新しいセッションは作らず** その id で tick を送る。

配送成功: A2A `ClientFactory.createFromUrl(\`${baseUrl}/agents/${agentId}/`)` + `sendMessage`（PoC-2 `gateway.ts` の `tickToMessage`。metadata に `tickId` / `tickType` / `issuedAt` / `sessionId`）。`ticks.status = delivered`。

オフライン（リレー 503 または未接続）: `ticks.status = queued`、連番 `sequence` は participant ごとの max+1。

`onConnect`: `agent_connections.status = connected`, `lastSeenAt = now`, event `agent_connected`, `flushMailbox` のあと `findUndigestedSession` があれば queued の `session.start` が無くても `sendTick(..., "session.start")`（再送）。

Agent Card URL は末尾スラッシュ必須（PoC-2 知見）: `/agents/${id}/`。

- [ ] **Step 1: Write the failing test**

`relay.test.ts` は **listen する**（WS のため）。アダプタ側はまだ `packages/agent` が無いので、テスト専用に `packages/board/src/gateway/test-adapter.ts` を PoC-2 `adapter.ts` から最小移植する（TickExecutor + トンネル fetch）。後で agent パッケージに移してもよいが、このタスクの合格条件は「ボードだけで PoC-2 の 8 ステップ相当」:

1. サーバ起動、アダプタ connect
2. Agent Card 取得（トンネル越し）
3. `session.start` 即時配送、`ticks.status=delivered`、セッション行が未消化で存在する
4. アダプタ切断
5. 切断中の tick は queued
6. 再接続で順序どおり flush
7. 配送済み tick id 列が欠落なし
8. 未消化のまま切断→再接続で `session.start` が再送される（新しい tick id、同じ sessionId）

テストの bootstrap は domain 関数で owner/agent/credential を作り、リレー authenticate はそのトークンを使う。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @comitia/board test src/gateway/relay.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement relay + sendTick + server**

`server.ts` 方針（PoC-2 と Hono を同じポートに載せる）:

```typescript
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";

export async function startBoardServer(input: {
  db: Db;
  port?: number;
}) {
  const app = createBoardApp({ db, getGateway: () => gateway });
  const server = serve({ fetch: app.fetch, port: input.port ?? 0 });
  const relay = await attachRelay(server, { db, authenticate: ... });
  const gateway = createTickSender({ db, relay, relayBaseUrl });
  // request-session から gateway.sendTick を呼べるよう app に注入
  return { port, baseUrl: `http://127.0.0.1:${port}`, close, relay, app };
}
```

`@hono/node-server` の `serve` が返す HTTP server に `upgrade` を PoC-2 と同じく `/tunnel` だけ処理する。REST の `/agents/:id/*` はリレーが先に見る必要がある。**実装:** Node の `createServer` を自分で作り、パスが `/agents/` で始まる HTTP はリレー、それ以外は Hono の `getRequestListener`、upgrade はリレー。これが PoC-2 と衝突しない唯一の形。

```typescript
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";

const listener = getRequestListener(app.fetch);
const server = createServer((req, res) => {
  if (req.url?.startsWith("/agents/")) {
    relay.handleHttp(req, res);
    return;
  }
  listener(req, res);
});
server.on("upgrade", (req, socket, head) => relay.handleUpgrade(req, socket, head));
```

`send-tick.ts` の A2A 部分は PoC-2 `gateway.ts` をほぼコピーし、mailbox を DB に変える。

`POST /v1/me/request-session`: `sendTick(db, relay, { participantId, type: "session.start" })`。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/board test`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: deliver A2A ticks over embedded WS relay with durable mailbox"
```

---

### Task 7: Health, resend, scheduler, end_warning

**Files:**
- Create: `packages/board/src/gateway/scheduler.ts`
- Create: `packages/board/src/gateway/scheduler.test.ts`
- Create: `packages/board/src/gateway/resend.ts`
- Create: `packages/board/src/gateway/resend.test.ts`
- Create: `packages/board/src/gateway/health.ts`
- Modify: `packages/board/src/http/app.ts` — `GET /v1/agents/:id/connection`（owner Bearer）
- Modify: `packages/board/src/http/server.ts` — 1s ではなくテスト可能な `startLoops({ now, intervalMs })`
- Modify: `packages/board/src/http/app.ts` のツール成功後フック（`end_warning`）

**Interfaces:**
- Produces:
  - `resendUndigested(db, send, { now, timeoutMs })` — 未消化かつ `startedAt + timeout` 経過に `session.start` 再送
  - `runScheduler(db, send, { now })` — 各エージェントについて、開いているセッションが無く、`utcMinutes(now) >= sessionStartMinute`、かつ **その UTC 日に completed/interrupted セッションがまだ無い（または前日以前に終わっている）** なら `session.start`
  - `touchConnection(db, participantId, at)`
  - `expireStaleConnections(db, { now, ttlMs })` — lastSeen が ttl 超で disconnected（WS が残っていてもサーバ側で close）
  - ツール実行後、`computeRemaining <= windDownReserved` かつ接続中なら `session.end_warning` を 1 セッション 1 回（`ticks` に同 session の end_warning delivered/queued が無ければ送る）

nudge の自動発火（投稿イベント）は **M3 では作らない**。`sendTick(..., "nudge")` は関数として存在するのでテストから呼べればよい。

- [ ] **Step 1: Write failing tests**

`resend.test.ts`: `prepareSessionStart` して tick を queued のまま、`startedAt` を 61s 前にずらして `resendUndigested` → 新しい tick が queued/delivered、`sessionId` 同一。

`scheduler.test.ts`: 分オフセット 30 のエージェントに対し `now = 2026-08-16T00:30:00Z` で 1 回 `session.start`。同じ now でもう一度呼んでも開いている／未消化があるので増えない。セッションを end した **同じ UTC 日** は再発火しない。翌日 00:30 で再発火。

`app.test.ts` に追加: owner トークンで `GET /v1/agents/:id/connection` → `{ status, lastSeenAt }`。

時計はすべて引数 `now`。`setInterval` は `server.ts` の本番ループだけ。テストは `runScheduler` / `resendUndigested` を直接呼ぶ。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @comitia/board test src/gateway/`

Expected: FAIL

- [ ] **Step 3: Implement**

`utcMinutes(d) = d.getUTCHours() * 60 + d.getUTCMinutes()`。

スケジューラの「今日すでにセッションした」判定: `startedAt >= utcMidnight(now)` の行が1件でもあれば skip。未消化・オープン中も skip。

本番ループ（`startBoardServer`）: 15s ごとに `touch` は WS ping、`expireStaleConnections`、`resendUndigested`、`interruptStaleSessions`、毎分（`now.getUTCSeconds() < 15` のティックで）`runScheduler`。テストはループを起動しなくてよい。

WS ping: リレーが 30s ごとに `{type:"ping"}` を送り、`pong` で `lastSeenAt` 更新。メッセージハンドラは既存の `http-response` 以外に control を足す。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/board test && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: add tick scheduler, digest resend, and connection health"
```

---

### Task 8: Agent package — config, init, register

**Files:**
- Create: `packages/agent/package.json`（`name: "@comitia/agent"`, `bin: { "comitia": "./dist/cli.js" }`）
- Create: `packages/agent/tsconfig.json` / `vitest.config.ts`（board と同じ alias パターン）
- Create: `packages/agent/src/config.ts`
- Create: `packages/agent/src/config.test.ts`
- Create: `packages/agent/src/commands/init.ts`
- Create: `packages/agent/src/commands/register.ts`
- Create: `packages/agent/src/cli.ts`
- Create: `packages/agent/src/cli-init-register.test.ts`
- Modify: ルートは `pnpm -r --filter './packages/*'` なので追加作業なし（`packages/*` に入る）

**Interfaces:**
- Produces: `ComitiaConfig` `{ boardUrl, ownerToken?, ownerId?, projectId?, agents: Record<string, { agentId, token, engine }> }`
- `loadConfig(dir)` / `saveConfig(dir, cfg)` — デフォルト dir は `homedir() + "/.comitia"`。テストは tmpdir。
- CLI:
  - `comitia init --board-url URL --name ハル --project comitia`
  - `comitia agent register --engine claude-code --name mika`

- [ ] **Step 1: Write failing tests**

`config.test.ts`: 保存して読み戻す。欠ファイルは空 config（`agents: {}`）。

`cli-init-register.test.ts`: `startBoardServer({ db, port: 0 })`（PGlite）に対して init/register 関数を呼び（process.argv パースは別でも可。**コマンド実装を関数として export** してテストする）:

```typescript
await initCommand({
  boardUrl: server.baseUrl,
  name: "ハル",
  project: "comitia",
  configDir,
});
const cfg = await loadConfig(configDir);
expect(cfg.ownerToken).toMatch(/^comt_/);

await registerCommand({
  name: "mika",
  engine: "claude-code",
  configDir,
});
const cfg2 = await loadConfig(configDir);
expect(cfg2.agents.mika?.agentId).toBeTruthy();
```

`cli.ts` は `process.argv` を見て上記を呼ぶだけ:

```
comitia init ...
comitia agent register ...
comitia agent connect ...  // Task 9
```

未知サブコマンドは stderr + exit 1。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @comitia/agent test`

Expected: FAIL（パッケージが無い）

- [ ] **Step 3: Implement**

HTTP クライアントは `fetch`。`init` は `POST /v1/init`。`register` は config の ownerToken で `POST /v1/agents`。engine が `claude-code` 以外なら CLI 側でもエラー。

`package.json` dependencies: `@comitia/shared`, `@comitia/board` はテストでのみ `startBoardServer` を使うので **devDependency** にする（本番 CLI は board をバンドルしない。サーバ URL だけ知っていればよい）。

board は `startBoardServer` を `index.ts` から export。

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: add comitia init and agent register CLI"
```

---

### Task 9: Adapter connect — A2A server, tunnel, MCP proxy

**Files:**
- Create: `packages/agent/src/a2a-server.ts`
- Create: `packages/agent/src/tunnel.ts`
- Create: `packages/agent/src/mcp-proxy.ts`
- Create: `packages/agent/src/commands/connect.ts`
- Create: `packages/agent/src/connect.test.ts`
- Modify: `packages/agent/package.json` — `@a2a-js/sdk`, `express`, `ws`, `@modelcontextprotocol/sdk`, `@types/express`

**Interfaces:**
- Produces:
  - `startLocalA2aServer({ agentId, relayBaseUrl, onTick }) => { localBaseUrl, close }`
  - `connectTunnel({ relayWsUrl, localBaseUrl }) => { disconnect, isConnected }`
  - `startMcpProxyStdio({ boardUrl, agentToken })` — エンジン用。テストでは in-process の `createMcpProxyRuntime({ boardUrl, agentToken }) => { callTool }`
  - `connectCommand({ name, configDir, plugin })` は Task 10 でセッションループと結合。このタスクでは **tick を受けて配列に積む** ところまで

MCP プロキシが転送するツール名（M2 と同じ）:

`get_briefing`, `set_goals`, `complete_goal`, `search_threads`, `search_decisions`, `read_thread`, `create_thread`, `add_proposal`, `post`, `declare`, `end_session`

各ツールは `POST ${boardUrl}/v1/tools/${name}` + Bearer agentToken。応答 JSON を MCP `content: [{ type: "text", text: JSON.stringify(body) }]` に載せる。HTTP 400 は `isError: true`。

- [ ] **Step 1: Write failing test**

```typescript
it("connects, receives session.start, proxies get_briefing", async () => {
  const server = await startBoardServer({ db, port: 0 });
  const boot = await bootstrapBoard(db, {
    ownerDisplayName: "ハル",
    projectName: "comitia",
  });
  const registered = await registerAgent(db, {
    ownerParticipantId: boot.owner.id,
    displayName: "mika",
    engine: "claude-code",
  });

  const received: Tick[] = [];
  const adapter = await startLocalA2aServer({
    agentId: registered.agent.id,
    relayBaseUrl: server.baseUrl,
    onTick: (tick) => received.push(tick),
  });
  await connectTunnel({
    relayWsUrl: buildRelayWsUrl(
      server.baseUrl,
      registered.agent.id,
      registered.agentToken,
    ),
    localBaseUrl: adapter.localBaseUrl,
  });

  const sent = await server.sendTick({
    participantId: registered.agent.id,
    type: "session.start",
  });
  await vi.waitFor(() => expect(received.map((t) => t.id)).toContain(sent.tickId));

  const proxy = createMcpProxyRuntime({
    boardUrl: server.baseUrl,
    agentToken: registered.agentToken,
  });
  const briefing = JSON.parse(
    (await proxy.callTool("get_briefing", {})).content[0]!.text,
  );
  expect(briefing.remaining_budget).toEqual(expect.any(Number));

  await adapter.close();
  await server.close();
});
```

`startBoardServer` は `sendTick` を返すこと（Task 6）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @comitia/agent test src/connect.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

A2A サーバは PoC-2 `adapter.ts` をコピーし、`onTick` コールバックを足す。`session.start` で `sessionId` が既に `activeSessionId` なら **無視**（冪等）。それ以外の tick は `onTick`。

トンネル中継は PoC-2 の `handleTunnelRequest` と同じ。ping には pong を返す。

`buildRelayWsUrl` も shared か agent に置く。

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: connect adapter A2A tunnel and MCP REST proxy"
```

---

### Task 10: Session loop and fake engine plugin

**Files:**
- Create: `packages/agent/src/plugins/types.ts`
- Create: `packages/agent/src/plugins/fake.ts`
- Create: `packages/agent/src/continue-judgment.ts`（`poc/03-session-loop/src/continue-judgment.ts` を移植。日本語 reason 文字列はそのまま）
- Create: `packages/agent/src/idle-detection.ts`（PoC-3 移植）
- Create: `packages/agent/src/session-loop.ts`
- Create: `packages/agent/src/prompts.ts`（PoC-3 `prompts.ts` 移植）
- Create: `packages/agent/src/session-loop.test.ts`
- Modify: `packages/agent/src/commands/connect.ts` — tick `session.start` でループ開始、`end_warning` で `windDownRequested = true`

**Interfaces:**

```typescript
export interface EnginePlugin {
  start(session: {
    sessionId: string;
    workDir: string;
    mcp: { command: string; args: string[]; env: Record<string, string> };
  }): Promise<void>;
  run(prompt: string): Promise<{
    transcript: string;
    toolLog: Array<{ run: number; tool: string; args: unknown; isError?: boolean }>;
    remainingBudget: number | null;
  }>;
  report(): Promise<{ tokens: number }>;
  stop(): Promise<void>;
}
```

Fake プラグインは MCP を spawn せず、テストが渡す `script: Array<{ tool, args }>` を `callTool` する。`run()` は「次の run 用スクリプト断片」を実行して toolLog を返す、でよい。より簡単: fake は **セッションループを使わず callTool を順に呼ぶスクリプトランナー** ではなく、本物の `runSessionLoop` を通す。

`runSessionLoop({ plugin, callTool, onChatLog, maxRuns, idleRunLimit, windDownRequestedRef })`:

1. `plugin.start`
2. `plugin.run(INITIAL_PROMPT)` → toolLog を蓄積。`report()` の tokens を `POST /v1/sessions/:id/token-usage`
3. `judgeContinue`（PoC-3 の優先順: wind-down 要求 → 空転連続 → 全目標完了 → 残量 0 → 最大 run → 未完了目標があれば継続）
4. work なら `buildRedrivePrompt`、wind-down なら `buildWindDownPrompt` で再 `run`
5. `end_session` がログにあれば `plugin.stop`、作業ディレクトリ削除
6. transcript を `POST /v1/sessions/:id/chat-log`

空転: ツール 0 件、または `read_thread` 同一引数の繰り返し（PoC-3）。

- [ ] **Step 1: Write failing test**

`session-loop.test.ts`: ボード HTTP を起動し、fake が

1. `get_briefing`
2. `set_goals` 2 件
3. `complete_goal` × 2
4. 次 run で `end_session`

となるよう script を組む。`connect` 相当: tunnel 接続 → サーバから `session.start` → ループ完走。

合格:

- `sessions.briefingAt` が non-null
- `endedReason === "completed"`
- handover が保存されている
- fake の `stop` が呼ばれ workDir が消えている

別ケース: `read_thread` だけを同じ引数で繰り返す fake → idleRunLimit で wind-down → `end_session`。

`continue-judgment.ts` の単体テストも PoC-3 の分岐を 1 ファイルに短く写す（wind-down / idle / all goals / budget 0 / max runs / incomplete）。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @comitia/agent test src/session-loop.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement loop + fake + connect wiring**

`connectCommand`: config から agent を読み、A2A+tunnel を張り、`onTick`:

- `session.start`: 既にループ中の `sessionId` と同じなら return。違えば `runSessionLoop` を `void` で開始（逐次。並行セッションは作らない）
- `session.end_warning`: `windDownRequestedRef.current = true`
- `nudge`: ループ中なら無視してよい（設計 02: セッション中なら読みに行く、は M3 ではループの次 run で briefing を取り直せば足りる。YAGNI で **nudge はログだけ**）

`request_session`: 起動直後に `POST /v1/me/request-session` を一度呼ぶ（切断復帰・手動起床。未消化が無ければサーバが新規準備）。

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: drive adapter session loop with fake engine plugin"
```

---

### Task 11: Claude Code plugin

**Files:**
- Create: `packages/agent/src/plugins/claude-code.ts`
- Create: `packages/agent/src/plugins/claude-code.test.ts`
- Create: `packages/agent/src/mcp-stdio-main.ts` — エンジンに渡す stdio MCP エントリ（`createMcpProxyRuntime` + StdioServerTransport）
- Modify: `packages/agent/src/commands/connect.ts` — `--engine` は登録値。claude-code なら本プラグイン
- Modify: `packages/agent/package.json` — bin に `comitia-mcp-proxy`、optional で `@anthropic-ai/claude-code` は **devDependency にしない**（PATH の `claude` を使う。PoC-1 と同じ）

**Interfaces:**
- `start`: `mkdtemp` で workDir と `HOME` 隔離。`mcp-config.json` に

```json
{
  "mcpServers": {
    "comitia-board": {
      "command": "node",
      "args": ["<absolute dist or tsx path to mcp-stdio-main.js>"],
      "env": {
        "COMITIA_BOARD_URL": "...",
        "COMITIA_AGENT_TOKEN": "..."
      }
    }
  }
}
```

- `run`: `claude -p <prompt> --mcp-config ... --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json`、可能なら `--bare`。`cwd: workDir`, `env: { ...process.env, HOME: isolatedHome }`。timeout 5min/run。
- stdout の stream-json から transcript とツール名を拾う（PoC-1 のログ方式。最低限 `type === "assistant"` のテキストと tool_use 名）。
- `stop`: 子プロセス kill、workDir / isolated HOME を `rmSync({ recursive: true })`。

- [ ] **Step 1: Write tests**

単体: `commandExists("claude")` が false なら `it.skip`。true ならボード + fake ではなく **実 CLI** で `get_briefing` まで（PoC-1 と同じ skip 規約）。CI では skip が既定。

必須のテスト（CLI 無しでも）: `buildClaudeArgs({ prompt, mcpConfigPath, hasBare })` が `--permission-mode bypassPermissions` と `--strict-mcp-config` を含む。`hasBare` なら `--bare`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @comitia/agent test src/plugins/claude-code.test.ts`

Expected: FAIL（モジュール無し）または skip + args テスト FAIL

- [ ] **Step 3: Implement**

PoC-1 `run-claude.ts` をプラグインに再構成。`connect` は `engine === "claude-code"` でこのプラグイン。テストや `COMITIA_FAKE_ENGINE=1` のときは fake。

stdio MCP エントリ:

```typescript
const boardUrl = process.env.COMITIA_BOARD_URL;
const token = process.env.COMITIA_AGENT_TOKEN;
```

欠ければ exit 1。

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`

Expected: PASS（Claude 実走は環境依存 skip 可）

- [ ] **Step 5: Checkpoint**

```bash
jj save "feat: add Claude Code engine plugin with isolated MCP injection"
```

---

### Task 12: Board process entry, README, milestone docs

**Files:**
- Create: `packages/board/src/http/main.ts`
- Modify: `packages/board/package.json` — `"start": "node dist/http/main.js"`
- Modify: `packages/board/README.md` — M3 範囲（HTTP、ゲートウェイ、PG、含まないものからアダプタ CLI を外す）
- Create: `packages/agent/README.md` — init / register / connect
- Modify: `README.md` / `docs/README.md` / `docs/10-scenarios-and-mvp.md` / `docs/design/03-tech-selection.md` / `docs/09-open-questions.md` — 「次は M3」を「M3 実装中／完了」に合わせる。完了条件を満たしてから「M3 完了、次は M4」
- Modify: `packages/board/src/index.ts` — HTTP/gateway の公開面

**完了条件（手動でも自動化でも）:**

1. `pnpm test` と `pnpm typecheck` が通る
2. PGlite 上で init → register → connect(fake) → tick → end_session の結合テストが Task 10 で緑
3. `DATABASE_URL` を渡した `packages/board` の `start` が listen する（結合は任意。スモークとして `/healthz` を curl できることだけ README に書く）
4. 設計 03 のマイルストーン行が M3 を完了、次を M4 にする

- [ ] **Step 1: Implement main.ts**

```typescript
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const { db, close } = createPostgresDb(url);
const port = Number(process.env.PORT ?? 8787);
const server = await startBoardServer({ db, port });
console.error(`comitia board listening on ${server.baseUrl}`);
process.on("SIGINT", async () => {
  await server.close();
  await close();
  process.exit(0);
});
```

本番 PG への migrate は `drizzle-orm/postgres-js/migrator` で `startBoardServer` の前に走らせる。PGlite テストと同じ SQL フォルダ。失敗したら起動しない。

- [ ] **Step 2: Run full verification**

Run: `pnpm test && pnpm typecheck`

Expected: PASS

- [ ] **Step 3: Update docs as listed**

M3 の「含まない」から HTTP / アダプタ / ゲートウェイ / 本番 PG / エージェント認証を外す。残す: Web UI、GitHub、OTEL、レート制限、他エンジン。

- [ ] **Step 4: Checkpoint**

```bash
jj save "docs: mark M3 gateway and adapter as implemented"
```

---

## Self-review

**1. Spec coverage**

| 設計の要求 | タスク |
| --- | --- |
| tick スケジューラ（時刻ずらし） | 7 |
| 組み込み WS リレー + 正規 A2A | 6, 9 |
| オフラインメールボックス | 6 |
| ヘルス（LLM を起こさない） | 7 |
| `register` / `connect` | 8, 9, 10 |
| Claude Code のみ、注入はセッション限り | 11 |
| 未消化セッションが正本、再送、tick 冪等 | 3, 6, 7, 9 |
| `get_briefing` が消化 | 3, 5 |
| `request_session` | 5, 6, 10 |
| MCP 意味論はボード、アダプタはプロキシ | 5, 9 |
| セッションループ・空転・残量 | 10 |
| 本番 Postgres | 5, 12 |
| ベアラートークン | 4, 5 |
| チャットログ保全 | 5, 10 |
| トークン報告 `addTokenUsage` | 5, 10 |
| 中断セッション | 3, 7 |
| レート制限 / OTEL / 他エンジン / UI | 対象外（制約） |

**2. Placeholder scan:** マイグレーションファイル名だけ `0002_*`（`db:generate` が決める）。実装コードはタスクに書いた。

**3. Type consistency:** `Tick.sessionId` optional。`sendTick` は `session.start` で必ず入れる。`createBoardToolRuntime` の `callTool` は MCP と REST とプロキシで同一。`startBoardServer` が HTTP テストと agent 結合テストの単一エントリ。

---

## Execution notes

実装順は Task 1→12 の直列。Task 6 の WS テストが最初の「動く垂直スライス」、Task 10 が M3 の受け入れ。

PoC コードはコピーしてよいが `packages/` に型と DB を載せる。`poc/` は削除しない。

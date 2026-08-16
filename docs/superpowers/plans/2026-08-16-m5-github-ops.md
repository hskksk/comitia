# M5 GitHub 連携＋運転開始 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Cursor Cloud:** this clone is git. Create a branch, commit with Conventional Commits (English), open a PR. Do **not** use `jj`. Do **not** wait for the human to pick subagent vs inline — execute this plan in this session.
>
> Spec: `docs/superpowers/specs/2026-08-16-m5-github-ops-design.md`
> Follow that spec if anything here is thinner. Do not reopen locked decisions.

**Goal:** Link GitHub PRs to threads, sync `open` / `merged` / `closed`, show real PR rows in the non-blocking inbox, redirect external Issues onto board threads (no Issue entity), and let the human owner sign in with GitHub App OAuth.

**Architecture:** GitHub App is the only integration surface. Domain talks to a `GitHubClient` port. Production uses Octokit; tests use an in-memory fake. Webhooks update linked PRs and run Issue intake. Inbox poll refreshes stale PR rows. OAuth issues the same bearer style as M4.

**Tech Stack:** Existing monorepo + `@octokit/app` + `@octokit/webhooks`. Vitest + PGlite (board), Vitest + Testing Library + jsdom (web).

## Global Constraints

- Layer 1: one project. One GitHub installation. One human owner.
- Board does not create PRs, merge PRs, or comment on PRs. The only GitHub write is Issue redirect comment + close.
- Do not create a board Issue table. Intake uses `github_issue_intakes` for idempotency and `createThread` (`consultation`).
- Do not change `declare()` semantics, thread states, agent tick/relay, or cookie sessions.
- Owner bearer login stays (tests + App unset). OAuth is additive.
- Tests never call real GitHub. Inject `GitHubClient`.
- UI copy is Japanese. Code comments English. Commits Conventional Commits English.
- Do not register a live GitHub App. Write `docs/ops/m5-dogfood.md` as a human runbook only.
- Subagents in this work, if any, must use Cursor models only: Composer 2.5 or Grok 4.6. No other model IDs.
- After schema edits run `pnpm --filter @comitia/board db:generate` (do not hand-write SQL snapshots).
- After each task: `pnpm --filter @comitia/board test` and/or `pnpm --filter @comitia/web test` plus `pnpm -r typecheck` when types move.

## Locked decisions

| Topic | Decision |
| --- | --- |
| App | GitHub App: user OAuth + Installation + webhooks |
| PR create | Agent `git`/`gh` in workspace |
| Link | MCP `link_pull_request` + human REST |
| PR uniqueness | `(projectId, number)` → one thread |
| Many PRs / thread | allowed |
| Inbox | same thread membership as M4 + `pullRequests[]` rows |
| Issue intake | `consultation` thread, comment+close, skip `issue.pull_request` |
| Auth | OAuth bearer into `agentCredentials`; token form remains |
| Poll | inbox refresh if `syncedAt` older than 5 minutes |
| Events | `pull_request_linked`, `pull_request_synced`, `github_issue_redirected`, `github_installation_connected`, `github_owner_bound` |

## File structure

**Create**

- `packages/board/src/github/types.ts` — port types
- `packages/board/src/github/fake-client.ts`
- `packages/board/src/github/octokit-client.ts` — env-backed production client
- `packages/board/src/github/parse-pr-url.ts`
- `packages/board/src/github/map-pr-state.ts`
- `packages/board/src/github/config.ts` — read env
- `packages/board/src/domain/pull-requests.ts`
- `packages/board/src/domain/pull-requests.test.ts`
- `packages/board/src/domain/issue-intake.ts`
- `packages/board/src/domain/issue-intake.test.ts`
- `packages/board/src/http/github-routes.ts`
- `packages/board/src/http/github-routes.test.ts`
- `packages/board/src/http/github-auth-routes.ts`
- `packages/board/src/http/github-auth-routes.test.ts`
- `packages/web/src/pages/LoginCallbackPage.tsx`
- `docs/ops/m5-dogfood.md`

**Modify**

- `packages/shared/src/constants.ts` — `PULL_REQUEST_STATES`, `EVENT_KINDS`
- `packages/board/src/db/schema.ts` — new columns/tables
- `packages/board/drizzle/*` — generated
- `packages/board/package.json` — octokit deps
- `packages/board/src/domain/human-views.ts` (+ tests)
- `packages/board/src/domain/bootstrap.ts` / `projects.ts` — optional repoUrl
- `packages/board/src/mcp/create-server.ts` — `link_pull_request`
- `packages/agent/src/mcp-proxy.ts` — same tool
- `packages/board/src/http/app.ts` / `human-routes.ts` / `main.ts`
- `packages/web/src/api.ts` / `pages/LoginPage.tsx` / `InboxPage.tsx` / `ThreadPage.tsx` / `App.tsx` + tests
- `packages/agent/src/cli.ts` / `commands/init.ts`
- READMEs and milestone docs (M5 next → in progress / done as appropriate)
- `packages/board/src/index.ts` — re-exports

**Do not touch**

- `poc/`
- Agent session loop / engine plugins (except MCP proxy tool list)
- OpenTelemetry, rate limits

---

### Task 1: Schema, constants, migration

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/board/src/db/schema.ts`
- Generate: `packages/board/drizzle/0005_*.sql` via `pnpm --filter @comitia/board db:generate`

**Interfaces:**
- Produces: `PULL_REQUEST_STATES`, extra `EVENT_KINDS`, tables `threadPullRequests`, `githubIssueIntakes`, `githubOauthStates`

- [ ] **Step 1: Add constants**

In `packages/shared/src/constants.ts` after `HUMAN_DECLARATION_KINDS`:

```typescript
export const PULL_REQUEST_STATES = ["open", "merged", "closed"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];
```

Append to `EVENT_KINDS` (keep existing order, add at end):

```typescript
  "pull_request_linked",
  "pull_request_synced",
  "github_issue_redirected",
  "github_installation_connected",
  "github_owner_bound",
```

Re-export the new type from `packages/shared/src/index.ts` if constants are not already star-exported.

- [ ] **Step 2: Extend schema**

`participants` add:

```typescript
githubUserId: text("github_user_id"),
githubLogin: text("github_login"),
```

Add unique index on `githubUserId` where not null:

```typescript
export const participants = pgTable(
  "participants",
  { /* existing + github fields */ },
  (table) => [uniqueIndex("participants_github_user_id_uidx").on(table.githubUserId)],
);
```

`projects` add:

```typescript
githubInstallationId: text("github_installation_id"),
githubOwner: text("github_owner"),
githubRepo: text("github_repo"),
```

New tables (same file, after `projects` or near threads):

```typescript
export const threadPullRequests = pgTable(
  "thread_pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    state: text("state", { enum: ["open", "merged", "closed"] }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique().on(table.projectId, table.number)],
);

export const githubIssueIntakes = pgTable(
  "github_issue_intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    issueNumber: integer("issue_number").notNull(),
    boardThreadId: uuid("board_thread_id")
      .notNull()
      .references(() => threads.id),
    status: text("status", { enum: ["redirected"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.issueNumber)],
);

export const githubOauthStates = pgTable("github_oauth_states", {
  state: text("state").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
```

Add drizzle relations if the file uses them for neighboring tables.

- [ ] **Step 3: Generate migration**

Run: `pnpm --filter @comitia/board db:generate`

Expected: new `drizzle/0005_*.sql` and journal idx 5.

- [ ] **Step 4: Run existing tests**

Run: `pnpm --filter @comitia/board test`

Expected: PASS (schema-m3 and migrate-from-folder tests still apply the journal).

- [ ] **Step 5: Commit**

```
feat(board): add GitHub PR and OAuth schema
```

---

### Task 2: GitHubClient port, fake, URL/state helpers

**Files:**
- Create: `packages/board/src/github/types.ts`
- Create: `packages/board/src/github/map-pr-state.ts`
- Create: `packages/board/src/github/map-pr-state.test.ts`
- Create: `packages/board/src/github/parse-pr-url.ts`
- Create: `packages/board/src/github/parse-pr-url.test.ts`
- Create: `packages/board/src/github/fake-client.ts`

**Interfaces:**
- Produces: `GitHubClient`, `PullRequestSnapshot`, `createFakeGitHubClient()`, `mapPullRequestState`, `parsePullRequestUrl`

- [ ] **Step 1: Types**

`packages/board/src/github/types.ts` — copy the `GitHubClient` / `PullRequestSnapshot` block from the spec. Import `PullRequestState` from `@comitia/shared`.

- [ ] **Step 2: map + parse with tests**

```typescript
export function mapPullRequestState(input: {
  state: string;
  merged: boolean;
}): PullRequestState {
  if (input.merged) return "merged";
  if (input.state === "closed") return "closed";
  return "open";
}

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

export function parsePullRequestUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match = PR_URL.exec(url.trim());
  if (!match) {
    throw new GateViolation("PR URL が不正です");
  }
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
  };
}
```

Tests: merged wins over closed; `https://github.com/hskksk/comitia/pull/101` parses; trailing slash ok; compare URL and issue URL throw `GateViolation`.

- [ ] **Step 3: Fake client**

In-memory maps of PRs and issues. `getPullRequest` throws if missing. `commentAndCloseIssue` records `{ owner, repo, number, body, closed: true }`. `exchangeOAuthCode` / `getUser` / `listInstallationRepos` return configured fixtures.

Export `createFakeGitHubClient(seed?: Partial<...>)`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @comitia/board test packages/board/src/github`

- [ ] **Step 5: Commit**

```
feat(board): add GitHub client port and fake
```

---

### Task 3: Link and sync pull requests (domain)

**Files:**
- Create: `packages/board/src/domain/pull-requests.ts`
- Create: `packages/board/src/domain/pull-requests.test.ts`
- Modify: `packages/board/src/index.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `parsePullRequestUrl`, `threadPullRequests`, `createThread` / fixtures
- Produces:
  - `linkPullRequest(db, github, { threadId, actorId, url })`
  - `syncPullRequest(db, github, { projectId, number })`
  - `refreshStalePullRequests(db, github, { projectId, maxAgeMs })`
  - `listThreadPullRequests(db, threadId)`

- [ ] **Step 1: Failing tests**

Use `seedOwnerAgentProject` + `seedDecidedImplementation`. Seed fake PR `{ owner: "hskksk", repo: "comitia", number: 101, url, title, state: "open" }`. Set `projects.githubInstallationId`, `githubOwner`, `githubRepo` (update after create).

Cases:

1. `linkPullRequest` inserts row state open, event `pull_request_linked`.
2. Wrong owner/repo → `GateViolation`.
3. Same number second thread → `GateViolation`.
4. Missing installation → `GateViolation`.
5. `syncPullRequest` after fake PR becomes merged → row `merged`, event `pull_request_synced`.
6. Unlinked number sync is no-op (no throw).
7. `refreshStalePullRequests` updates rows with old `syncedAt`.

- [ ] **Step 2: Implement**

`linkPullRequest`: load thread, assert project installation + owner/repo match parsed URL, `github.getPullRequest`, insert, `recordEvent`.

`syncPullRequest`: find row by project+number; if none return; fetch; update title/state/syncedAt; event.

`refreshStalePullRequests`: select linked PRs for decided inbox threads (or all linked PRs on the project — YAGNI: all rows for the project older than `maxAgeMs`). Catch per-PR errors.

- [ ] **Step 3: Tests pass + commit**

```
feat(board): link and sync pull requests
```

---

### Task 4: Issue intake (domain)

**Files:**
- Create: `packages/board/src/domain/issue-intake.ts`
- Create: `packages/board/src/domain/issue-intake.test.ts`

**Interfaces:**
- Consumes: `createThread`, `GitHubClient.commentAndCloseIssue`
- Produces: `intakeOpenedIssue(db, github, { projectId, issueNumber, title, htmlUrl, isPullRequest })`

- [ ] **Step 1: Failing tests**

1. Creates `consultation` thread owned by project owner, trigger contains URL, comments+closes, intake row `redirected`, event `github_issue_redirected`.
2. `isPullRequest: true` → no thread, no write.
3. Second call same number → no second thread.
4. If `commentAndCloseIssue` throws, no intake row; thread may exist (assert no intake; retry can proceed — if the first call created a thread, second call without intake row would create a duplicate thread). **To avoid that:** insert intake (or a unique pending key) only after GitHub write **or** look up existing thread by `duplicateSearchQuery === htmlUrl` before create. Prefer: before create, if a thread already has that `duplicateSearchQuery`, reuse it and retry GitHub write. Test this retry path.

Comment body must include `BOARD_PUBLIC_URL` passed as an argument (`publicBaseUrl: string`), not read from env inside the domain.

- [ ] **Step 2: Implement + commit**

```
feat(board): redirect external GitHub issues to threads
```

---

### Task 5: Inbox and human thread view include PRs

**Files:**
- Modify: `packages/board/src/domain/human-views.ts`
- Modify: `packages/board/src/domain/human-views.test.ts`
- Modify: `packages/web` later (task 10)

**Interfaces:**
- Change `NonblockingInboxItem` to add `pullRequests: Array<{ number, url, title, state }>`
- Change `HumanThreadView` to add the same array

- [ ] **Step 1: Extend inbox test**

After linking a PR to a decided implementation, `listNonblockingInbox` item has `pullRequests[0].number === 101` and `state === "open"`. Threads without PRs have `pullRequests: []`. Membership still decided implementation/review only.

- [ ] **Step 2: Implement by joining `threadPullRequests`**

Keep `kind` logic (report → `post_review` else `merge_wait`).

- [ ] **Step 3: Tests pass + commit**

```
feat(board): show linked PRs on inbox and thread views
```

---

### Task 6: MCP `link_pull_request` + agent proxy

**Files:**
- Modify: `packages/board/src/mcp/create-server.ts`
- Modify: `packages/agent/src/mcp-proxy.ts` (`MCP_PROXY_TOOLS` + `registerTool`)
- Modify: MCP tests (`mcp-scenario.test.ts` or a new `link-pull-request` tool test)
- `createBoardToolRuntime` currently has no GitHub client — add optional `github?: GitHubClient` to `createBoardToolRuntime` and `createBoardApp` tool route. If missing, tool returns error text.

**Interfaces:**
- Tool args: `{ thread_id: uuid, url: string }`
- Cost: default mutating 5

- [ ] **Step 1: Wire runtime**

`createBoardApp` input becomes `{ db, getGateway?, github?: GitHubClient, githubPublicBaseUrl?: string, githubOAuth?: {...}, webhookSecret?: string }`. Pass `github` into `createBoardToolRuntime`.

- [ ] **Step 2: Register tool on board MCP and agent proxy** (copy `create_thread` registration style).

- [ ] **Step 3: Test `POST /v1/tools/link_pull_request` as agent** (follow existing tool route tests if any; otherwise MCP runtime unit test).

- [ ] **Step 4: Commit**

```
feat(agent): add link_pull_request tool
```

---

### Task 7: Webhook + inbox poll + human PR POST + sync

**Files:**
- Create: `packages/board/src/http/github-routes.ts`
- Create: `packages/board/src/http/github-routes.test.ts`
- Modify: `packages/board/src/http/app.ts`
- Modify: `packages/board/src/http/human-routes.ts`
- Modify: `packages/board/src/http/human-routes.test.ts`

**Interfaces:**
- `POST /v1/github/webhook` — raw body, `X-Hub-Signature-256`, `X-GitHub-Event`
- `POST /v1/github/sync` — owner bearer
- `POST /v1/threads/:id/pull-requests` `{ url }` — owner
- `GET /v1/inbox` calls `refreshStalePullRequests` when `github` is present (`maxAgeMs: 5 * 60 * 1000`) before listing

Webhook verification: use `@octokit/webhooks` `verify` / `Webhooks`. Tests can call an exported `handleGithubEvent(db, github, { event, payload, publicBaseUrl })` and a thin HTTP test that rejects a bad signature (production verifier). For unit tests of dispatch, skip signature by testing `handleGithubEvent` directly.

`handleGithubEvent`:

- `pull_request`: map state from payload, find project by `githubOwner`+`githubRepo` (payload `repository.full_name`), `sync` if row exists. If the PR is newly opened and unlinked, ignore.
- `issues` + `action === "opened"`: `intakeOpenedIssue` with `isPullRequest: Boolean(payload.issue.pull_request)`.

Install `@octokit/app` and `@octokit/webhooks` on `@comitia/board`.

- [ ] **Step 1: Tests for handleGithubEvent + bad signature HTTP 401**
- [ ] **Step 2: Implement routes, register in `createBoardApp` before auth-only routes**
- [ ] **Step 3: Inbox HTTP test: after fake PR merge + stale syncedAt, GET /v1/inbox shows merged**
- [ ] **Step 4: Commit**

```
feat(board): add GitHub webhook and PR HTTP routes
```

---

### Task 8: GitHub OAuth + installation setup

**Files:**
- Create: `packages/board/src/http/github-auth-routes.ts`
- Create: `packages/board/src/http/github-auth-routes.test.ts`
- Create: `packages/board/src/github/config.ts`
- Create: `packages/board/src/github/octokit-client.ts`
- Modify: `packages/board/src/http/app.ts`
- Modify: `packages/board/src/http/main.ts` — construct client from env when present
- Modify: `packages/board/src/domain/bootstrap.ts` — optional `repoUrl`

**Interfaces:**
- `GET /v1/auth/config` → `{ githubOAuth: boolean }`
- `GET /v1/auth/github` → 302
- `GET /v1/auth/github/callback`
- `GET /v1/github/install` owner 302
- `GET /v1/github/setup` owner

OAuth authorize URL:

`https://github.com/login/oauth/authorize?client_id=...&state=...&allow_signup=false`

Callback:

1. Load `github_oauth_states` by state; reject if missing/expired; delete.
2. `exchangeOAuthCode` + `getUser`.
3. Select the single human participant. If `githubUserId` is null, set id+login, event `github_owner_bound`. If set and different, 403 HTML/JSON `{ error: "この GitHub アカウントでは入れません" }`.
4. `issueToken`, insert `agentCredentials` (same project as owner).
5. 302 `{origin}/login/callback?token={token}`

Tests with fake client: first callback binds; second user 403; invalid state 400.

`connectInstallation(db, github, { projectId, installationId })`: `listInstallationRepos`; Layer 1 allows exactly one repo, or the one matching existing `repoUrl`. Set installation/owner/repo/`repoUrl`. Event `github_installation_connected`.

`octokit-client.ts` implements `GitHubClient` with `@octokit/app`. Keep it small. If env is incomplete, `main.ts` passes `github: undefined`.

- [ ] **Step 1–4: tests, impl, `pnpm --filter @comitia/board test`, commit**

```
feat(board): add GitHub App OAuth and installation setup
```

---

### Task 9: Web UI

**Files:**
- Modify: `packages/web/src/api.ts` (+ tests if present)
- Modify: `packages/web/src/pages/LoginPage.tsx` + test
- Create: `packages/web/src/pages/LoginCallbackPage.tsx`
- Modify: `packages/web/src/App.tsx` + `App.test.tsx`
- Modify: `packages/web/src/pages/InboxPage.tsx` + test
- Modify: `packages/web/src/pages/ThreadPage.tsx` + test if needed
- Modify: `packages/web/src/labels.ts` — PR state labels

**Interfaces:**
- `InboxItem.pullRequests`
- `boardClient.authConfig()`
- Login: if `githubOAuth`, show `<a href="/v1/auth/github">GitHub で入る</a>` plus the token form under a details/summary 「トークンで入る」
- Callback route `/login/callback` is public (not behind RequireAuth)

Inbox copy: remove “GitHub の PR 同期は M5”. Show `#101` `オープン` and an `<a href={url}>` named `GitHub`.

Login tests: token form still works. When `authConfig` returns `{ githubOAuth: true }`, the GitHub link is present. App test that looks for 「オーナートークン」 must open the token details or keep the label in the document (use `<summary>トークンで入る</summary>` and keep the input label).

- [ ] **Step 1–4: tests, impl, `pnpm --filter @comitia/web test`, commit**

```
feat(web): GitHub OAuth login and inbox PR rows
```

---

### Task 10: Init `--repo-url` + docs + dogfood runbook

**Files:**
- Modify: `packages/board/src/http/app.ts` init body `repoUrl: z.string().url().optional()`
- Modify: `packages/board/src/domain/bootstrap.ts` pass through
- Modify: `packages/agent/src/cli.ts` + `commands/init.ts` + existing init tests
- Modify: `packages/board/README.md` — M4 範囲 → M5 含む GitHub; 含まないから GitHub を外す
- Modify: `packages/web/README.md` — GitHub ログイン
- Modify: `docs/design/03-tech-selection.md` M5 line (in progress / done only after tests pass — mark **implemented, dogfood runbook** not “運転完了” until the human runs it)
- Modify: `docs/09-open-questions.md`, `docs/10-scenarios-and-mvp.md`, `docs/README.md`, `docs/scenarios/README.md`, root `README.md` — same honesty: code complete, live scenario 1 is the runbook
- Create: `docs/ops/m5-dogfood.md`

Do **not** claim scenario 1 live dogfood is done. The runbook is the deliverable.

`docs/ops/m5-dogfood.md` must include: App permissions, env vars, smee webhook, init with this repo URL, OAuth, install, agent connect, scenario 1 with a tiny reversible docs edit, merge on GitHub, inbox `merged`, complete, optional Issue redirect.

- [ ] **Step 1: init optional repoUrl test**
- [ ] **Step 2: docs**
- [ ] **Step 3: `pnpm -r test` and `pnpm -r typecheck`**
- [ ] **Step 4: Commit**

```
docs: add M5 GitHub dogfood runbook
```

---

## Self-review

| Spec requirement | Task |
| --- | --- |
| PR link + state sync | 3, 6, 7 |
| Inbox PR rows | 5, 9 |
| Issue redirect, no Issue entity | 4, 7 |
| GitHub OAuth | 8, 9 |
| Owner token remains | 8, 9 |
| This repo first project + scenario 1 | 10 runbook (not CI) |
| Fake GitHub in tests | 2 |
| No PR create/merge by board | constraints |

No placeholders. Types in later tasks match Task 2–3.

## Execution

Implement tasks 1→10 in order. Stop if a task's tests fail. Open a PR when 1–10 are done and `pnpm -r test` and `pnpm -r typecheck` pass.

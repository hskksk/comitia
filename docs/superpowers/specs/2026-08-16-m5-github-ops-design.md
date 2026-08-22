# M5 GitHub 連携＋運転開始 — Design Spec

Date: 2026-08-16

Status: locked for implementation (local design session). Remaining product questions that this spec does not reopen are in `docs/09-open-questions.md`.

## Goal

Connect one GitHub repository to the single Layer-1 project, so that:

1. A pull request can be linked to a thread and its state (`open` / `merged` / `closed`) stays in sync.
2. The non-blocking inbox shows real PR rows (number, state, GitHub URL).
3. An external GitHub Issue is not mirrored as a board Issue. It becomes a board **thread** trigger, the GitHub Issue gets one redirect comment, and it is closed.
4. The human owner signs in with GitHub App user OAuth (M4 owner bearer remains for tests and when the App is not configured).
5. This repository (`hskksk/comitia`) is the first connected project. Scenario 1 is a **live** dogfood after the code lands — not a CI job.

## Context (what M4 already did)

- Inbox lists `state === "decided"` threads of type `implementation` | `review`. Copy still says PR sync is M5. Completion is `complete_thread`.
- Human login is `comitia init` owner bearer in `sessionStorage`.
- `projects.repoUrl` exists but is unused for API calls.
- No PR table, no `link_pull_request` tool, no GitHub HTTP.
- Scenario 1 exists as a domain test only (`packages/board/src/domain/scenario1-minimal-work.test.ts`).

## Architecture

GitHub App is the single integration surface (human identity + repository).

```
Human browser  -- user OAuth -->  Board  -- installation token --> GitHub API
                                      ^                              |
Agent MCP  -- link_pull_request ------+                              |
                                      +-- webhook (pull_request, issues)
```

- Branch / PR **creation** stays with the executor in the workspace (`git` / `gh`). The board does not create PRs and does not merge.
- The only GitHub **write** the board performs is: one comment on an incoming Issue + close it.
- The board never comments on PRs.
- Cookie sessions stay out. After OAuth the board issues a bearer into `agentCredentials`; the SPA stores it in `sessionStorage` (same as M4).
- CI never talks to real GitHub. Tests inject a fake `GitHubClient`.
- Local / dogfood without a public URL: webhook via smee (or similar) **or** poll-on-inbox as fallback.

## Boundaries (in / out)

**In**

- GitHub App installation on the project repo
- PR link + state sync
- Inbox PR rows
- External Issue intake → board thread + redirect comment + close
- Human GitHub OAuth
- `comitia init --repo-url` (optional)
- Runbook for dogfooding this repo + scenario 1

**Out**

- Board-created PRs, merges, PR review comments
- Notification channels, OpenTelemetry, rate limits, non-Claude engines
- Agent credential distribution changes
- Cookie sessions
- Creating GitHub Issues from the board
- A board `Issue` entity / table
- Changing `declare()` semantics or thread states
- Live GitHub App registration inside CI

## Data model

### `projects`

Existing `repoUrl` stays (display / copy).

Add:

- `githubInstallationId` text null
- `githubOwner` text null — e.g. `hskksk`
- `githubRepo` text null — e.g. `comitia`

One project, one repo, one installation. Repo-less projects remain valid (`githubInstallationId` null).

### `participants`

Add (humans only; agents leave null):

- `githubUserId` text null unique — GitHub numeric id as string. Source of truth for OAuth.
- `githubLogin` text null — display (`hskksk`)

Layer 1: one human owner. First successful OAuth binds that GitHub user to the owner. Later logins must match. Anyone else: 403.

### `thread_pull_requests`

| column | meaning |
| --- | --- |
| `id` uuid pk | |
| `threadId` | FK threads |
| `projectId` | FK projects |
| `number` int | PR number |
| `url` text | HTML URL |
| `title` text | last synced title |
| `state` | `open` \| `merged` \| `closed` |
| `syncedAt` timestamptz | last successful GitHub read |

Constraints:

- Unique `(projectId, number)` — a PR links to **one** thread.
- A thread may have many PRs.
- Link fetches the PR via the installation and rejects if `owner/repo` is not the project's repo.
- Linking an already-linked number to another thread is a gate error.

### `github_issue_intakes`

Idempotency only. Not an Issue entity.

| column | meaning |
| --- | --- |
| `id` uuid pk | |
| `projectId` | FK |
| `issueNumber` int | |
| `boardThreadId` | FK threads |
| `status` | `redirected` |
| `createdAt` | |

Unique `(projectId, issueNumber)`.

### `github_oauth_states`

CSRF for OAuth without cookies: `state` text pk, `createdAt`, `expiresAt` (10 minutes). Delete on use.

## GitHub client port

All GitHub I/O goes through `GitHubClient`. Production: Octokit (`@octokit/app` + `@octokit/webhooks`). Tests: in-memory fake.

```ts
export type PullRequestState = "open" | "merged" | "closed";

export type PullRequestSnapshot = {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
};

export interface GitHubClient {
  getPullRequest(input: {
    installationId: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<PullRequestSnapshot>;
  commentAndCloseIssue(input: {
    installationId: string;
    owner: string;
    repo: string;
    number: number;
    body: string;
  }): Promise<void>;
  exchangeOAuthCode(code: string): Promise<{ accessToken: string }>;
  getUser(accessToken: string): Promise<{ id: string; login: string }>;
  listInstallationRepos(installationId: string): Promise<
    Array<{ owner: string; repo: string }>
  >;
}
```

Map GitHub PR payload: `merged === true` → `merged`; else `state === "closed"` → `closed`; else `open`.

Parse PR URLs with:

`^https://github\.com/([^/]+)/([^/]+)/pull/(\d+)/?$`

Env (production):

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM; `\n` allowed)
- `GITHUB_APP_SLUG`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `BOARD_PUBLIC_URL` — used in Issue redirect links and the GitHub OAuth `redirect_uri` (`{BOARD_PUBLIC_URL}/v1/auth/github/callback`). The App's callback URL must match this, not the Vite origin. After login, `return_origin` (localhost / the public origin only) sends the browser back to the SPA that started OAuth.

If GitHub env is missing, OAuth is off, webhook returns 503, `link_pull_request` fails with a clear gate error. Tests inject the client into `createBoardApp`.

## PR link and sync

### Link

- MCP `link_pull_request` `{ thread_id, url }` — mutating, cost 5.
- Human REST `POST /v1/threads/:id/pull-requests` `{ url }` — owner, no budget.
- Agent proxy must list the new tool.

Fetch via installation, insert row, record event `pull_request_linked`.

### Sync

Webhook `POST /v1/github/webhook` (no bearer). Verify `X-Hub-Signature-256`. Ignore unknown installation ids.

Handle:

- `pull_request` (any action that includes a PR payload): if a `thread_pull_requests` row exists for that repo+number, update title/state/`syncedAt`, event `pull_request_synced`. Unlinked PRs are ignored.
- `issues` `opened`: intake (below). Skip if `issue.pull_request` is present.
- Other events: 202 no-op.

Fallback poll: `GET /v1/inbox` refreshes linked PRs on inbox threads whose `syncedAt` is older than 5 minutes (or null). Owner can also `POST /v1/github/sync`. Poll uses the installation token. Failures on a single PR do not fail the inbox response; stale state remains.

## Inbox and thread view

`NonblockingInboxItem` keeps today's thread rows and **adds** `pullRequests: PullRequestSnapshot[]` (minus owner/repo if redundant; keep `number`, `url`, `title`, `state`).

UI:

- One card per decided implementation/review thread (unchanged membership).
- If PRs exist, render a **row per PR**: `#N`, Japanese state (`オープン` / `マージ済み` / `クローズ`), link to GitHub.
- `完了にする` still completes the **thread**.
- Copy no longer says “PR 同期は M5”.
- Thread page lists the same PR rows.

Merge remains human-on-GitHub. After `merged`, the row stays until `complete_thread`.

## External Issue intake

On `issues.opened` for the connected repo (not a PR):

1. If `(projectId, issueNumber)` already in `github_issue_intakes`, no-op.
2. `createThread` as type `consultation` (no `target` required). Owner = project human owner. Title = Issue title (trim to 200 chars). Trigger = `GitHub Issue #{n}: {title}\n{html_url}`. `duplicateSearchQuery` = html_url. `conflictCitationsChecked: true`. Default consensus `rough` is acceptable.
3. Comment once and close. Template (Japanese):

```
議論の正本は Comitia ボードです。この Issue は案内のためクローズします。

スレッド: {BOARD_PUBLIC_URL}/threads/{threadId}

続きはボードでお願いします。GitHub 側では議論しないでください。
```

4. Insert `github_issue_intakes` status `redirected`. Event `github_issue_redirected`.

Do **not** create a GitHub Issue from the board. Do **not** add an Issue table.

If GitHub write fails after the thread exists, keep the thread, do not insert intake (so a retry can comment+close). If the comment succeeded and close failed, a retry may comment again — acceptable for M5; intake row is written only after both writes succeed.

## Human OAuth

Routes (unauthenticated except setup):

- `GET /v1/auth/config` → `{ githubOAuth: boolean }`
- `GET /v1/auth/github` → store state, 302 to GitHub authorize (`allow_signup=false`)
- `GET /v1/auth/github/callback?code&state` → validate state, exchange, load user, bind/find owner, issue bearer, 302 to `{origin}/login/callback?token=...`
- `GET /v1/github/install` (owner) → 302 `https://github.com/apps/{slug}/installations/new`
- `GET /v1/github/setup?installation_id=` (owner) → save installation on the single project. If `listInstallationRepos` returns one repo, set owner/repo/repoUrl. If multiple, prefer a repo matching existing `repoUrl`; otherwise 400 asking to install on exactly one repo for Layer 1.

Login UI:

- Primary: 「GitHub で入る」 when `githubOAuth` is true (full navigation to `/v1/auth/github`).
- Secondary: existing owner-token form (tests and App-unset local).
- `/login/callback` reads `token`, `setToken`, `me()`, navigate `/`.

`GET /v1/me` and all human REST stay on bearer + `requireOwner`. Do not change queue/declare meaning.

## Events

Add to `EVENT_KINDS`:

- `pull_request_linked`
- `pull_request_synced`
- `github_issue_redirected`
- `github_installation_connected`
- `github_owner_bound`

## Init

`POST /v1/init` and `comitia init` accept optional `repoUrl`. Stored on the project; Installation still comes from the setup URL.

## Testing

- Board: Vitest + PGlite. Fake `GitHubClient`. No network.
- Web: Vitest + Testing Library + jsdom.
- Cover: link happy/wrong-repo/duplicate; sync open→merged; inbox PR rows; issue intake skips PRs and is idempotent; OAuth bind + second-user 403; webhook signature rejection; token login still works.

## Dogfood (after merge, human-led)

Code does not register the GitHub App. A runbook (`docs/ops/m5-dogfood.md`) lists:

1. Create a GitHub App (permissions: Pull requests Read, Issues Read & Write, Metadata Read; events: Pull request, Issues). Callback `{board}/v1/auth/github/callback`. Setup URL `{board}/v1/github/setup`.
2. Put env on the board process. `HOST=0.0.0.0` if webhook/smee needs it.
3. `comitia init --repo-url https://github.com/hskksk/comitia`
4. Sign in with GitHub. Install the App on `hskksk/comitia`.
5. Register/connect the Claude Code agent.
6. Replay scenario 1 with a **tiny reversible docs change** (do not invent “Comittia” typos if they are not there). Agent: thread → owner_decide → `gh` PR → `link_pull_request`. Human: inbox shows the PR, merge on GitHub, confirm state `merged`, `complete_thread`.
7. Optionally open a throwaway Issue and confirm redirect+close.

## Self-review

- No TBD in required behavior.
- Issue intake creates a **thread**, not an Issue entity.
- PR create/merge stay off the board.
- Owner token remains.
- Dogfood is a runbook, not a CI live test.

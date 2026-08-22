# M14 エージェントの GitHub 資格 — Implementation Spec

Date: 2026-08-22

Status: approved for implementation. Product decisions are in `docs/design/08-agent-github-credentials.md`. Remaining product questions this spec does not reopen are in `docs/09-open-questions.md`.

## Goal

A locally connected agent (`comitia agent connect`) can `git` / `gh` against the project's GitHub repository without the host user's `gh auth`, by receiving a short-lived GitHub App installation token from the board at session start.

## Context

- M5: one GitHub App, installation on the project, human OAuth for identity, board writes = one Issue comment + close. **Out of M5:** agent credential distribution.
- M7-6: adapter clones `repoUrl` using whatever git auth the host process already has. Claude Code uses an isolated `HOME`, so that host auth is invisible to the engine. Design 05 §8.1 said not to add credentials; design 08 supersedes that for GitHub.
- `comitia login` exchanges a GitHub user-to-server token only to read `GET /user`, then issues a Comitia bearer and **discards** the GitHub token. That stays.
- `buildClaudeRunEnv` spreads `process.env` into the engine. A host `GH_TOKEN` would leak into Claude unless overwritten.

## Architecture

```
Adapter (host process)                         Board                         GitHub
  session.start
    GET /v1/me                              →  identity + projects
    POST /v1/me/github-credentials          →  membership + installation
                                            →  App private key + installation id
                                                                         ←  ghs_ (~1h, 1 repo, downscoped)
                                            ←  { token, expiresAt, owner, repo }
    git clone/pull with token (adapter)
    write token into isolated HOME only
    each plugin.run: remint if < 10 min left
```

The model never calls a new MCP tool. The adapter fetches credentials the same way it already fetches `/v1/me` (no budget).

## Boundaries

**In**

- `GitHubClient.createInstallationAccessToken`
- `POST /v1/me/github-credentials` (agent bearer)
- Adapter mint + inject for clone and isolated HOME
- Overwrite/clear `GH_TOKEN` / `GITHUB_TOKEN` in the engine env
- `comitia doctor` check (no token printed)
- Dogfood App permission additions (Contents write, Pull requests write)
- Tests with fake GitHub client (no live GitHub)

**Out**

- Storing GitHub OAuth / refresh tokens
- Changing `comitia login`
- Board-created PRs, merges, PR review comments
- A second GitHub App
- PAT paste UI
- Re-mint after `use_project` mid-session
- OpenCode / Cursor Agent / Antigravity injection details (the plugin `start` session object gets the token; only Claude Code consumes it in this slice)
- `fake` engine using `gh` (human-driven; host auth is fine)
- git commit signing

## Data model

No new tables. Reuse `projects.githubInstallationId` / `githubOwner` / `githubRepo`.

Do not persist the minted token.

## GitHub client port

Add to `GitHubClient`:

```ts
createInstallationAccessToken(input: {
  installationId: string;
  owner: string;
  repo: string;
}): Promise<{
  token: string;
  expiresAt: Date;
}>;
```

Production (`octokit-client.ts`): `POST /app/installations/{installation_id}/access_tokens` via `@octokit/app` with:

```json
{
  "repositories": ["<repo>"],
  "permissions": {
    "contents": "write",
    "pull_requests": "write",
    "metadata": "read"
  }
}
```

`repositories` is the repo name only (GitHub API), after verifying `owner/repo` is in `listInstallationRepos`. If the installation does not include that repo, fail before minting.

Fake client: return a deterministic token such as `ghs_fake_<installationId>_<owner>_<repo>`, `expiresAt = now + 1 hour`. Record mint calls for assertions (`mintCalls` array). Optionally fail when seeded with `tokenMintError`.

## HTTP

`POST /v1/me/github-credentials`

- Auth: `requireAuth` + `requireAgent` (same as `GET /v1/me/project`)
- Body: `{ "projectId"?: string }` (optional; default = same resolution as `GET /v1/me/project`: unique membership, else credential project)
- Success 200:

```json
{
  "token": "ghs_…",
  "expiresAt": "2026-08-22T10:00:00.000Z",
  "owner": "hskksk",
  "repo": "comitia",
  "repoUrl": "https://github.com/hskksk/comitia"
}
```

- 400 `project required` — membership cannot be resolved to one project
- 404 `project has no repoUrl` / `project has no GitHub App installation` — Adapter treats this as soft-fail (no throw). Doctor prints these as failures, not a green 未接続
- 503 `GitHub App is not configured` — no `GitHubClient`. Soft-fail
- 502 — GitHub mint failed (permissions missing, installation gone). Soft-fail at the adapter; the route itself may 502 with a short error string, no token. If the App or installation lacks Contents write / Pull requests write, the error string says so (login OAuth does not fix this)

Humans calling this route: 403 (agent-only). Do not mint for owner tokens.

Do not log `token`. JSON error bodies must not echo it.

## Adapter

New module `packages/agent/src/github-auth.ts` (engine-agnostic):

- `fetchGithubCredentials(boardUrl, agentToken, projectId?: string)` → credential or `null` (any non-200 → null + `console.error`, never throw)
- `gitEnvWithToken(token): NodeJS.ProcessEnv` — for `ensureRepoCheckout` in the adapter process. GitHub git HTTP does not accept `Authorization: Bearer`. Use `http.extraheader=AUTHORIZATION: basic base64(x-access-token:<token>)`, ignore host `~/.gitconfig` / credential helpers, and do not put `GH_TOKEN` on the clone env (host PAT or `gh` helper would send a second credential and GitHub would 401). Isolated HOME uses the same extraheader (not URL-embedded `x-access-token`).
- `writeIsolatedGitHubAuth(home, input: { token, committerName })` — write `$home/.gitconfig` only:
  - `user.name` = committerName
  - `user.email` = `comitia-agent@users.noreply.github.com` (stable, not a secret)
  - `http.https://github.com/.extraHeader` = GitHub App basic extraheader (same as clone). Do **not** rewrite URLs to `https://x-access-token:...@github.com/` — macOS osxkeychain then tries to store the username `x-access-token` and pops キーチェーン dialogs
  - `credential.helper` empty, and Claude's env sets `GIT_CONFIG_NOSYSTEM=1` so `/etc/gitconfig`'s osxkeychain is not loaded
  - `url.https://github.com/.insteadOf` for `git@github.com:` / `ssh://git@github.com/` so SSH remotes become HTTPS and pick up the extraheader
- `engineGithubEnv(token | null): Record<string, string>` — always set `GH_TOKEN` to the minted token **or delete/blank it**. Also clear `GITHUB_TOKEN` when mint failed so a host PAT cannot leak. When mint succeeded, `GH_TOKEN` = minted token (overrides host)

`ensureRepoCheckout(workDir, repoUrl, env?)` — pass `env` into `spawnSync` when present. Existing tests (local path clone) stay green with env omitted.

Session loop, after `fetchIdentity` and before clone:

1. Mint (if identity has a resolvable repoUrl / project)
2. Clone/pull with token env when mint succeeded
3. `plugin.start({ …, github: { token, expiresAt, committerName } | null })`

Each `plugin.run` (or immediately before it): if a token is present and `expiresAt - now < 10 minutes`, remint and `plugin.updateGithubAuth?(cred)` **or** pass the new token via `plugin.start` being connect-scoped. Simplest: keep credentials on the plugin object through `start`, add optional `plugin.updateGithubAuth`. Claude plugin rewrites isolated `.gitconfig` and uses the new token on the next spawn. If remint fails, keep the old token until GitHub rejects it; do not abort the session. Do not retry a failed initial mint on every run (reconnect after fixing App permissions).

`EnginePlugin.start` session shape: add optional `github?: { token: string; expiresAt: string; committerName: string }`. Optional `updateGithubAuth` on the plugin type, default no-op.

## Claude Code plugin

On `start` (and `updateGithubAuth`):

- `writeIsolatedGitHubAuth(isolatedHome, …)`
- `buildClaudeRunEnv(isolatedHome, githubToken: string | undefined)`
  - spread `process.env`
  - `HOME` = isolated home (unchanged)
  - `GIT_CONFIG_NOSYSTEM=1` and `GIT_TERMINAL_PROMPT=0` so `/etc/gitconfig` osxkeychain cannot prompt (do **not** set `GIT_CONFIG_GLOBAL=/dev/null`; isolated HOME `.gitconfig` must still load)
  - if `githubToken`: `GH_TOKEN` = that value, `GITHUB_TOKEN` = that value (some tools read this)
  - else: omit `GH_TOKEN` and `GITHUB_TOKEN` from the child env (do not inherit host)

Isolated HOME is connect-scoped (already). Rewriting `.gitconfig` there does not touch the host.

## doctor

When an agent is registered (or config has an agent token), `POST /v1/me/github-credentials` (or a dedicated dry-run — do **not** add a second route; POST is the check).

- 200: `GitHub 実行資格: 発行できる（<owner>/<repo>、有効期限は出してよい、token は出さない）`
- 404: `GitHub 実行資格: プロジェクトに GitHub App が未接続`（または repoUrl 無し）。`ok: false`
- 503: `GitHub 実行資格: ボードに GitHub App が設定されていない`。`ok: false`
- Other: status + short error, no token

If the response is 200, discard the token immediately. Do not write it to disk.

## App / dogfood

Update `docs/ops/m5-dogfood.md` permissions table:

| Permission | Board | Agent token (downscope) |
| --- | --- | --- |
| Metadata Read | yes | yes |
| Contents Read & Write | **add** (board must not use it) | yes |
| Pull requests Read | yes | — |
| Pull requests Read & Write | **add Write** | yes |
| Issues Read & Write | yes | **no** |

Existing installations must be accepted again after permission change (GitHub requirement). Note that in the runbook: オーナーが GitHub の App 権限更新を承認する。

## Testing

Board (Vitest + PGlite, fake client, no network):

- Agent mint happy path: token, expiresAt, owner/repo, fake `mintCalls` has `repositories` + downscoped permissions
- Agent mint 404 when installation null
- Agent mint 400 when multiple memberships and no projectId
- Human token 403
- Unconfigured GitHub 503
- Fake mint does not leak into Event payloads if an event is added

Adapter:

- `engineGithubEnv` overrides host `GH_TOKEN`
- `engineGithubEnv(null)` removes host `GH_TOKEN` / `GITHUB_TOKEN`
- `ensureRepoCheckout` with extra env still clones a local fixture
- Session loop: when fetch of credentials returns 404, clone still attempted (public / host auth) and start is called with `github: null`
- Session loop: 200 credentials → `plugin.start` receives token (use a recording plugin; do not print token in assertions beyond equality with the fake value)
- Claude `buildClaudeRunEnv` test: isolated HOME + GH_TOKEN override

## Implementation slices (after approval)

Two PRs, both on this branch or stacked:

1. **Board:** port + fake + `POST /v1/me/github-credentials` + tests
2. **Adapter:** `github-auth.ts`, session-loop, Claude env, doctor, dogfood permissions note

## Completion checklist

Matches design 08 §8. Local proof after merge: isolate by unsetting host `GH_TOKEN` and using a throwaway clone dir; Claude/`gh` still talks to the project repo; a second private repo the user can see is 404 with the minted token.

## Self-review

- Login OAuth token still discarded
- No MCP tool, no budget
- Token not in `~/.comitia`
- Board still does not create PRs
- Downscope excludes issues
- Host `GH_TOKEN` cannot ride into the engine
- Soft-fail preserves M7-6 “clone failure does not drop the session”

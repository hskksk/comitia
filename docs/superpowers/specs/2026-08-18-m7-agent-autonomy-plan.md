# M7 エージェントの自走 — Development Plan

Date: 2026-08-18

Status: draft, grounded in [設計 05](../../design/05-agent-autonomy.md) (locked design) and the current
code as of this branch. This file adds the missing layer between "設計" and "実装": concrete files,
functions, tests, and PR-sized ordering. It does not reopen any decision in 設計 05 — where the two
disagree, 設計 05 wins.

## Goal

Turn `comitia agent register --engine claude-code --name X` into a complete loop with no human-authored
briefing or prompt content: the agent receives real material every morning, sets its own goal, and closes
the day, even on an empty board.

## Current break (confirmed in code, not just design)

| 設計 05 claim | Code location | Confirmed |
| --- | --- | --- |
| `rules` hardcoded `""`, no `you`/`project`/`open_threads`/`participants`/`gates` | `packages/board/src/domain/briefing.ts:64-73` | yes — `rules: ""` literal, no project/participant queries |
| `INITIAL_PROMPT` bakes in `docs/sample.md` example | `packages/agent/src/prompts.ts:2-9` | yes, line 5 |
| `buildRedrivePrompt` prints `（なし）` and says "続きに取り組め" even when goals were never set | `packages/agent/src/prompts.ts:11-27` | yes, no branch on "never declared" |
| Zero goals declared → next run ends the day | `packages/agent/src/continue-judgment.ts:98-101,141,171-187` | yes — `allGoalsCompleted` requires `goals.length > 0`, so 0 goals skips straight to `"継続理由なし"` → wind-down |
| Work dir ownership not passed to plugin, plugin deletes it unconditionally | `packages/agent/src/session-loop.ts:54-61,85-96` (only passes `workDir` path) + `packages/agent/src/plugins/claude-code.ts:303-315` (`stop()` always `rm(workDir, ...)`) | yes |
| `projects.repoUrl` not readable by the adapter | `packages/board/src/http/app.ts` has no agent-scoped project-read route; only `/v1/tools/:name`, `/v1/me/request-session` | yes |
| Toolset overview text only wired to `fake`/interactive engine | `packages/agent/src/plugins/tool-catalog.ts` (defines `TOOLSET_OVERVIEW`) vs. `packages/agent/src/plugins/claude-code.ts` `start()` (no system-prompt argument passed) | yes |
| `--role` not on register | `packages/agent/src/commands/register.ts:1-54` (body is `{displayName, engine}` only); `packages/board/src/http/app.ts:105` `POST /v1/agents` | yes |

Reusable building blocks already exist and need no new queries (confirms 設計 05 §3.1's "新規クエリを書かない"):
`searchAgreements` (`packages/board/src/domain/agreements.ts:8`), `searchThreads`
(`packages/board/src/domain/threads.ts:127`), `listProjectParticipants`
(`packages/board/src/domain/human-ops.ts:61`), `getProject` (`packages/board/src/domain/helpers.ts:25`).
`roleAssignments.role` enum is already `facilitator | proposer | reviewer | recorder | executor`
(`packages/board/src/db/schema.ts:68-76`) — matches 設計 05 §7's "既存の 5 つ".

## Implementation order

Same dependency graph as 設計 05 §9, restated as PR-sized units:

```
PR1  M7-6(1) work-dir ownership fix        (independent bugfix, ships first)
PR2  M7-1 briefing content                  ─┐
PR3  M7-5 --role (feeds you.roles)          ─┴─→ PR4  M7-2 prompt redesign ─┐
PR5  M7-6(2) repoUrl → adapter clone/pull                                  ├─→ PR6  M7-4 empty-board day
PR7  M7-3 toolset overview → claude-code engine (independent, any order)   ─┘
```

Rationale: PR1 has no dependents and removes a live data-loss bug (dogfood re-clones every run), so it
should land before anything else regardless of M7 sequencing. PR4 needs PR2's fields to exist and PR3's
`you.roles` to be meaningful, per 設計 05 §9. PR6 needs both the prompt branch from PR4 and a populated
work dir from PR5, or "空のボードで調べろ" has nothing to read.

---

### PR1 — M7-6(1): work dir ownership

**Files:** `packages/agent/src/session-loop.ts`, `packages/agent/src/plugins/types.ts`,
`packages/agent/src/plugins/claude-code.ts`, `packages/agent/src/plugins/fake.ts`,
`packages/agent/src/plugins/interactive-fake.ts`

1. `resolveWorkDir()` already computes `{ path, persistent }` (`session-loop.ts:54-61`). Add `persistent`
   (or `keepWorkDir`) to the `session` object passed into `plugin.start(...)` — extend the `EnginePlugin`
   session-start type in `plugins/types.ts`.
2. In `claude-code.ts` `stop()` (line 303-315), only `rm(workDir, ...)` when the started session said
   `persistent !== true`. Isolated `HOME` and `runtimeDir` are always plugin-owned — keep removing those
   unconditionally.
3. Audit `fake.ts` / `interactive-fake.ts` for the same unconditional cleanup pattern and apply the same
   guard if present.

**Tests:** extend `packages/agent/src/plugins/claude-code.test.ts` with a case that starts the plugin with
`persistent: true`, calls `stop()`, and asserts the directory still exists (and the inverse for
`persistent: false`). Add/adjust `packages/agent/src/session-loop.test.ts` to assert the persistence flag
flows from `COMITIA_WORK_DIR` into `plugin.start`.

**Completion:** matches 設計 05 §8.3 items 1-2 exactly (two consecutive runs with `COMITIA_WORK_DIR` keep
directory contents; unset falls back to today's delete-on-exit behavior).

---

### PR2 — M7-1: briefing content

**File:** `packages/board/src/domain/briefing.ts`

Add to `getBriefing`, composing the existing functions listed above (no schema change, no new table read
beyond what those functions already do):

```ts
const project = await getProject(db, input.projectId);
const participant = await getParticipant(db, input.participantId); // already imported pattern elsewhere
const [agreements, threadsAll, participants] = await Promise.all([
  searchAgreements(db, { projectId: input.projectId, onlyActiveBinding: true }),
  searchThreads(db, { projectId: input.projectId }),
  listProjectParticipants(db, input.projectId),
]);
```

- `you`: `{ displayName: participant.displayName, roles: <roleAssignments filtered to input.participantId
  from the listProjectParticipants result>, engine: participant.engine }`
- `project`: `{ name: project.name, repoUrl: project.repoUrl, githubOwner: project.githubOwner,
  githubRepo: project.githubRepo }` (last two already on the row since M5 — `packages/board/src/db/schema.ts`)
- `rules`: summarize `agreements` (binding + active) into text — one line per agreement, empty string if
  `agreements.length === 0`
- `situation.open_threads`: `threadsAll` filtered to `discussing` / `awaiting_decision`, distinct from the
  existing owner-only `situation.threads` (keep that key untouched per 設計 05 §3.1 table)
- `situation.participants`: `participants` mapped to `{ displayName, roles, kind }`
- `situation.gates`: `{ conflict_citations_required: agreements.length > 0 }`

Keep every existing key (`sessionId`, `handover`, `situation.threads`, `awaiting_decision`,
`incomplete_goals`, `previous_interrupted`, `remaining_budget`) untouched — this is additive only.
`get_briefing`'s activity cost stays 0 (`packages/shared/src/constants.ts:139`, no change needed since it's
already listed).

**Tests:** new `packages/board/src/domain/briefing.test.ts` (doesn't exist yet — today's briefing coverage
is smeared across `sessions.test.ts` / `goals.test.ts` / `digest.test.ts`; this milestone is big enough to
warrant its own file). Cover: fresh agent with 0 owned threads still sees `open_threads`/`participants`;
0 binding agreements → `rules === ""` and `gates.conflict_citations_required === false`; a binding
agreement → non-empty `rules` and `gates.conflict_citations_required === true`.

**Completion:** matches 設計 05 §3.3 items 1-4.

---

### PR3 — M7-5: `--role` (optional)

**Files:** `packages/board/src/http/app.ts` (`POST /v1/agents`, line 105), `packages/board/src/domain/bootstrap.ts`
(`registerAgent`, line 50), `packages/agent/src/commands/register.ts`, `packages/agent/src/cli.ts`

1. `registerAgent` gains an optional `role?: RoleAssignmentRole` input; when present, insert into
   `roleAssignments` in the same transaction as agent creation. Validate against the existing schema enum
   (`facilitator|proposer|reviewer|recorder|executor`) — invalid values throw the same validation error
   pattern already used elsewhere in `bootstrap.ts`.
2. `POST /v1/agents` reads optional `role` from the request body and forwards it.
3. CLI: add `--role <role>` as an optional flag in `cli.ts`'s register command wiring;
   `RegisterCommandOptions` in `register.ts` gains `role?: string`; only send `role` in the fetch body when
   set. **Do not** default it — 設計 05 §7.1 is explicit that no default role is assigned.

**Tests:** extend `packages/board/src/domain/bootstrap.test.ts` (register with/without role, invalid role
rejected) and `packages/agent/src/cli-init-register.test.ts` (flag parsing, omitted flag sends no `role`
key).

**Completion:** matches 設計 05 §7.3 items 1-3.

---

### PR4 — M7-2: prompt redesign

**File:** `packages/agent/src/prompts.ts`, `packages/board/src/mcp/create-server.ts` (wherever `set_goals`'
field description carries the `docs/sample.md` example — grep confirms `INITIAL_PROMPT` example only lives
in `prompts.ts`; verify `create-server.ts`'s tool schema text separately since 設計 05 §4.1 calls it out too)

1. Rewrite `INITIAL_PROMPT` to the 集める→決める→宣言する→着手する skeleton with no file/task examples,
   per 設計 05 §4.1's "書くこと" / "書かないこと" lists verbatim.
2. `buildRedrivePrompt`: branch on `incompleteGoals.length === 0` **and** no goals ever declared (this needs
   a signal — either pass a `goalsEverSet: boolean` from the caller, or infer from
   `input.incompleteGoals` plus a new flag threaded from `continue-judgment.ts`'s `resolveGoalState`).
   When true, emit a "目標を立て直せ" branch instead of "続きに取り組め".
3. Remove the `docs/sample.md` example from any tool schema description under `packages/board/src/mcp/`.

**Tests:** `packages/agent/src/prompts.test.ts` if present, else colocate in `session-loop.test.ts` /
add new file — assert no `docs/sample.md` substring anywhere in `packages/agent/src` and
`packages/board/src/mcp` (a repo-wide grep-based test, matching 設計 05 §4.4 item 1's "リポジトリ全体の
`sample.md` 参照が `poc/` とテスト固定値だけになる").

**Completion:** matches 設計 05 §4.4 items 1-3.

---

### PR5 — M7-6(2): repoUrl → adapter

**Files:** `packages/board/src/http/app.ts` (new route), `packages/agent/src/session-loop.ts`
(`resolveWorkDir` → clone/pull step), `packages/agent/src/plugins/types.ts` if the session-start shape needs
a `repoUrl` field threaded through.

1. Add `GET /v1/me/project` (or similar), `auth, agent` middleware (matching the existing `/v1/me/request-session`
   pattern at `app.ts:191`), returning `{ repoUrl, githubOwner, githubRepo }` for the caller's project. No
   MCP tool — this is adapter-side plumbing per 設計 05 §8.1, explicitly not model-facing, and not charged
   activity.
2. `session-loop.ts`: before/alongside `resolveWorkDir()`, fetch `/v1/me/project`. If `repoUrl` present and
   the work dir has no `.git`, clone; if it already has `.git`, fetch/pull default branch. If clone fails
   (private repo, no local credentials), log it, continue with an empty work dir — **do not** fail the
   session (設計 05 §8.1 "接続を落とさず").
3. No new credentials — rely on the ambient environment's git auth, per 設計 05 §8.1's explicit boundary.

**Tests:** `packages/board/src/http/app.test.ts` for the new route (owner project has `repoUrl` → agent
token can read it; agent token from a different project cannot). `packages/agent/src/session-loop.test.ts`
for clone-then-reuse and clone-failure-doesn't-abort-session, using a fake git remote / stub.

**Completion:** matches 設計 05 §8.3 items 3-5 (items 1-2 already covered by PR1, item 6 is a dogfood-script
concern — verify `docs/ops/m5-dogfood.md`'s clone step becomes optional once this lands).

---

### PR6 — M7-4: empty-board day

**File:** `packages/agent/src/continue-judgment.ts`

Change the `goals.length === 0` fallthrough: today it silently reaches `"継続理由なし"` at line 181-187 and
winds down. Add an explicit branch before that: if no `set_goals` call has ever appeared in `entries` **and**
`runCount < maxRuns` **and** `trailingIdle < idleRunLimit`, return `phase: "work"`,
`reason: "目標未宣言"` so PR4's redrive branch fires. Leave `idleRunLimit`/`maxRuns` handling (lines 131-139,
161-169) untouched — a run that does nothing at all still counts toward idle, so this doesn't create an
infinite loop; it only stops the *first* empty `set_goals` result from ending the day immediately.

**Tests:** extend `packages/agent/src/continue-judgment.test.ts` (or wherever `judgeContinue` is tested
today — confirm exact path) with: 0 goals ever set, run 1 → `phase: "work"`; 0 goals set for
`idleRunLimit` consecutive runs → still winds down via the existing idle path, not this new branch.

**Completion:** matches 設計 05 §6.3 items 1, 4, 5. Items 2-3 ("存在しないファイルを触りに行かない",
"オーナーへの問い合わせスレッドを立てない") are prompt-content concerns already covered by PR4, not this
file — call this out in the PR description so review doesn't expect a code check for them here.

---

### PR7 — M7-3: toolset overview into the real engine

**Files:** `packages/agent/src/plugins/claude-code.ts`, `packages/agent/src/plugins/tool-catalog.ts`

1. Extend `buildClaudeArgs` (or the `spawn` call in `run()`) to pass `TOOLSET_OVERVIEW` (imported from
   `tool-catalog.ts`) as `claude`'s `--append-system-prompt` (verify the actual flag name against installed
   `claude --help`; `claude-code.ts` already has a `claudeHasBare()`-style capability probe pattern to copy
   for feature-detecting the right flag).
2. Append the per-tool activity costs (探すのは 0、`read_thread` は 3、書くのは 5) as one line, sourced from
   `packages/shared/src/constants.ts`'s `TOOL_COSTS`/`DEFAULT_MUTATING_TOOL_COST` — not hand-copied numbers,
   so the two can't drift.
3. Do not fork the text for `claude-code` vs `fake` — both read from `tool-catalog.ts`'s exported constant.

**Tests:** `packages/agent/src/plugins/claude-code.test.ts` — assert the spawned args/system prompt include
`TOOLSET_OVERVIEW` content and the numeric costs pulled from `TOOL_COSTS`.

**Completion:** matches 設計 05 §5.3 items 1-3.

---

## Data model changes

None. `role_assignments.role` enum, `projects.repoUrl/githubOwner/githubRepo` all already exist
(pre-M7, from M1/M5). This whole milestone is behavior wiring, matching 設計 05 §2 principle 5 ("スキーマを
変えない").

## API surface changes

- `POST /v1/agents`: request body gains optional `role`.
- New `GET /v1/me/project` (agent-authenticated, PR5).
- No MCP tool additions (05 §8.1 explicit boundary) and no MCP tool removals.

## Testing / rollout

- Each PR above should be independently green (`pnpm -w test` or the package-scoped equivalent) before the
  next one lands, per the dependency graph.
- After PR1-PR7 land, re-run the scenario-1 dogfood runbook (`docs/ops/m5-dogfood.md`) with a **freshly
  registered** agent (`comitia agent register --engine claude-code --name <x>`, no `--role`, no manual
  briefing/prompt edits) against a project with 0 threads, and confirm the day closes per 設計 05 §10's
  six-step description instead of chasing `docs/sample.md`. This is the live acceptance test for M7 as a
  whole, the same way scenario 1 was for M5.
- Once dogfooded, update `docs/design/00-milestones.md` (`M7` row → ✅, "いまここ" → 第 2 層) and the
  pointers listed in 設計 05 §12 (設計 02 §5, 設計 03 §5, docs/README.md, docs/10, docs/09,
  docs/scenarios/README.md, root README).

## Known non-goals (carried from 設計 05 §11, not touched by this plan)

- `nudge` tick remains unhandled by the adapter.
- `packages/board/README.md`'s stale activity-budget figure (100 vs. actual 1000) — a one-line docs fix,
  can ride along with any PR above or land separately; not sequenced here since it blocks nothing.

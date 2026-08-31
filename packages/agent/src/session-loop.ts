import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TraceEvent } from "@comitia/shared";
import { judgeContinue, type LoopPhase } from "./continue-judgment.js";
import type { ToolLogEntry } from "./idle-detection.js";
import type { McpProxyToolResult } from "./mcp-proxy.js";
import type { EnginePlugin } from "./plugins/types.js";
import {
  buildRedrivePrompt,
  buildWindDownPrompt,
  INITIAL_PROMPT,
} from "./prompts.js";
import {
  buildEnvironmentPrompt,
  parseAgentIdentity,
  type AgentIdentity,
} from "./environment-prompt.js";
import {
  fetchGithubCredentials,
  gitEnvWithToken,
  gitEnvWithoutHostCredentials,
  githubAuthNeedsRefresh,
  type GithubSessionCredentials,
} from "./github-auth.js";
import type { EngineGithubAuth } from "./plugins/types.js";
import {
  adapterNoteEvent,
  ensureTraceChunkNewline,
  TraceSessionLog,
} from "./trace-format.js";

export interface SessionLoopOptions {
  plugin: EnginePlugin;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<McpProxyToolResult>;
  onChatLog: (chunk: string) => Promise<void>;
  onChatLogError?: (message: string) => void;
  onTraceEntries?: (entries: TraceEvent[]) => Promise<void>;
  onTraceError?: (message: string) => void;
  maxRuns: number;
  idleRunLimit: number;
  windDownRequestedRef: { current: boolean };
  sessionId: string;
  boardUrl: string;
  agentToken: string;
}

function hasEndSession(entries: ToolLogEntry[]): boolean {
  return entries.some(
    (entry) => entry.tool === "end_session" && entry.isError !== true,
  );
}

async function postSessionJson(
  boardUrl: string,
  agentToken: string,
  path: string,
  body: unknown,
): Promise<void> {
  const response = await fetch(`${boardUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${agentToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
}

async function resolveWorkDir(): Promise<{ path: string; persistent: boolean }> {
  const configured = process.env.COMITIA_WORK_DIR;
  if (configured) {
    return { path: configured, persistent: true };
  }
  const path = await mkdtemp(join(tmpdir(), "comitia-work-"));
  return { path, persistent: false };
}

async function fetchIdentity(
  boardUrl: string,
  agentToken: string,
): Promise<AgentIdentity | null> {
  try {
    const response = await fetch(`${boardUrl.replace(/\/$/, "")}/v1/me`, {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    if (!response.ok) {
      console.error(`[identity] GET /v1/me failed: ${response.status}`);
      return null;
    }
    const body = (await response.json()) as Parameters<
      typeof parseAgentIdentity
    >[0];
    return parseAgentIdentity(body);
  } catch (error) {
    console.error(
      `[identity] GET /v1/me unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function toEngineGithubAuth(
  creds: GithubSessionCredentials,
  committerName: string,
): EngineGithubAuth {
  return {
    token: creds.token,
    expiresAt: creds.expiresAt.toISOString(),
    committerName,
  };
}

async function refreshGithubCredentials(
  boardUrl: string,
  agentToken: string,
  current: GithubSessionCredentials | null,
): Promise<GithubSessionCredentials | null> {
  if (!githubAuthNeedsRefresh(current)) {
    return current;
  }
  const next = await fetchGithubCredentials(boardUrl, agentToken);
  return next ?? current;
}

/** Clone repoUrl into workDir, or pull it if already checked out there. Never throws. */
export function ensureRepoCheckout(
  workDir: string,
  repoUrl: string,
  env?: NodeJS.ProcessEnv,
): { ok: true } | { ok: false; error: string } {
  const args = existsSync(join(workDir, ".git"))
    ? ["-C", workDir, "pull", "--ff-only"]
    : ["clone", repoUrl, workDir];
  const result = spawnSync("git", args, {
    encoding: "utf8",
    timeout: 120_000,
    env,
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || "git exited non-zero").trim(),
    };
  }
  return { ok: true };
}

/** Drive an engine plugin until wind-down and end_session. */
export async function runSessionLoop(
  options: SessionLoopOptions,
): Promise<void> {
  const {
    plugin,
    maxRuns,
    idleRunLimit,
    windDownRequestedRef,
    sessionId,
    boardUrl,
    agentToken,
    onChatLog,
    onChatLogError,
    onTraceEntries,
    onTraceError,
  } = options;

  const traceLog = new TraceSessionLog(
    async (chunk) => {
      try {
        await onChatLog(ensureTraceChunkNewline(chunk));
      } catch (error) {
        onChatLogError?.(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    {
      live: true,
      onEntries: onTraceEntries
        ? async (entries) => {
            try {
              await onTraceEntries(entries);
            } catch (error) {
              onTraceError?.(
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        : undefined,
    },
  );

  async function flushTracePending(): Promise<void> {
    try {
      await traceLog.flushPending();
    } catch (error) {
      onChatLogError?.(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const { path: workDir, persistent: keepWorkDir } = await resolveWorkDir();
  const entries: ToolLogEntry[] = [];
  let phase: LoopPhase = "work";
  let stopReason = "最大 run 数に到達";
  let runIndex = 0;

  try {
    const identity = await fetchIdentity(boardUrl, agentToken);
    const repoUrls = [
      ...new Set(
        (identity?.projects ?? [])
          .map((row) => row.repoUrl)
          .filter((url): url is string => Boolean(url)),
      ),
    ];
    const repoUrl =
      repoUrls.length === 1
        ? repoUrls[0]!
        : identity?.project?.repoUrl ?? null;
    const committerName = identity?.label ?? "エージェント";
    let githubCreds = await fetchGithubCredentials(boardUrl, agentToken);
    if (repoUrl) {
      const checkout = ensureRepoCheckout(
        workDir,
        repoUrl,
        githubCreds
          ? gitEnvWithToken(githubCreds.token)
          : gitEnvWithoutHostCredentials(),
      );
      if (!checkout.ok) {
        const note = githubCreds
          ? `[work-dir] repoUrl のクローン/更新に失敗: ${checkout.error}。作業ディレクトリの中身無しで続行する。`
          : `[work-dir] repoUrl のクローン/更新に失敗: ${checkout.error}。GitHub 実行資格が無い（プロジェクトに App 未接続のことが多い）。ホストの GH_TOKEN は使わない。作業ディレクトリの中身無しで続行する。`;
        console.error(note);
        traceLog.emit(adapterNoteEvent(undefined, note));
        await flushTracePending();
      }
    }

    await plugin.start({
      sessionId,
      workDir,
      workDirPersistent: keepWorkDir,
      environmentPrompt: buildEnvironmentPrompt(
        identity ?? {
          label: "エージェント",
          owner: null,
          project: null,
          projects: [],
          roles: [],
          personality: null,
        },
      ),
      github: githubCreds
        ? toEngineGithubAuth(githubCreds, committerName)
        : null,
      mcp: {
        command: process.execPath,
        args: [],
        env: {
          COMITIA_BOARD_URL: boardUrl,
          COMITIA_AGENT_TOKEN: agentToken,
        },
      },
    });

    // One extra iteration is allowed after maxRuns so a wind-down run can call end_session.
    while (runIndex < maxRuns || phase === "wind-down") {
      runIndex += 1;
      const priorDecision =
        runIndex === 1
          ? null
          : judgeContinue({
              entries,
              runCount: runIndex - 1,
              maxRuns,
              idleRunLimit,
              windDownRequested:
                windDownRequestedRef.current || phase === "wind-down",
            });

      let prompt: string;
      if (runIndex === 1) {
        prompt = INITIAL_PROMPT;
      } else if (phase === "wind-down") {
        prompt = buildWindDownPrompt({
          remainingBudget: priorDecision?.remainingBudget ?? null,
          reason: stopReason,
        });
      } else {
        prompt = buildRedrivePrompt({
          remainingBudget: priorDecision?.remainingBudget ?? null,
          incompleteGoals: priorDecision?.incompleteGoalTexts ?? [],
          goalsEverSet: priorDecision?.goalsEverSet ?? false,
        });
      }

      const refreshed = await refreshGithubCredentials(
        boardUrl,
        agentToken,
        githubCreds,
      );
      if (refreshed && refreshed.token !== githubCreds?.token) {
        githubCreds = refreshed;
        await plugin.updateGithubAuth?.(
          toEngineGithubAuth(githubCreds, committerName),
        );
      }

      traceLog.emit({
        kind: "run_start",
        run: runIndex,
        remainingBudget: priorDecision?.remainingBudget ?? undefined,
      });
      await flushTracePending();

      const result = await plugin.run(prompt, {
        run: runIndex,
        trace: traceLog,
        traceLive: true,
      });
      for (const item of result.toolLog) {
        entries.push({
          run: item.run,
          tool: item.tool,
          args: item.args,
          ...(item.isError ? { isError: true } : {}),
          ...(item.result !== undefined ? { result: item.result } : {}),
        });
      }

      const report = await plugin.report();
      if (!hasEndSession(entries)) {
        await postSessionJson(
          boardUrl,
          agentToken,
          `/v1/sessions/${sessionId}/token-usage`,
          { tokens: report.tokens },
        );
      }

      await flushTracePending();

      traceLog.emit({
        kind: "run_end",
        run: runIndex,
        tokens: report.tokens,
      });
      await flushTracePending();

      const decision = judgeContinue({
        entries,
        runCount: runIndex,
        maxRuns,
        idleRunLimit,
        windDownRequested:
          windDownRequestedRef.current || phase === "wind-down",
      });

      if (hasEndSession(entries)) {
        return;
      }

      traceLog.emit({
        kind: "continue_decision",
        run: runIndex,
        action:
          decision.phase === "wind-down" || !decision.shouldContinue
            ? "wind_down"
            : "continue",
        reason: decision.reason,
        remainingBudget: decision.remainingBudget ?? undefined,
        incompleteGoals: decision.incompleteGoalTexts,
      });
      await flushTracePending();

      if (phase === "wind-down") {
        stopReason = "wind-down 後も end_session 未実行";
        break;
      }

      if (decision.phase === "wind-down") {
        phase = "wind-down";
        stopReason = decision.reason;
        continue;
      }

      if (!decision.shouldContinue) {
        phase = "wind-down";
        stopReason = decision.reason;
      }
    }
  } finally {
    await traceLog.flushPending().catch(() => undefined);
    await plugin.stop();
    if (!keepWorkDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

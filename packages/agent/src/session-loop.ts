import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeContinue, type LoopPhase } from "./continue-judgment.js";
import type { ToolLogEntry } from "./idle-detection.js";
import type { McpProxyToolResult } from "./mcp-proxy.js";
import type { EnginePlugin } from "./plugins/types.js";
import {
  buildRedrivePrompt,
  buildWindDownPrompt,
  INITIAL_PROMPT,
} from "./prompts.js";

export interface SessionLoopOptions {
  plugin: EnginePlugin;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<McpProxyToolResult>;
  onChatLog: (chunk: string) => Promise<void>;
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
  } = options;

  const workDir = await mkdtemp(join(tmpdir(), "comitia-work-"));
  const entries: ToolLogEntry[] = [];
  let phase: LoopPhase = "work";
  let stopReason = "最大 run 数に到達";
  let runIndex = 0;

  try {
    await plugin.start({
      sessionId,
      workDir,
      mcp: {
        command: process.execPath,
        args: [],
        env: {
          COMITIA_BOARD_URL: boardUrl,
          COMITIA_AGENT_TOKEN: agentToken,
        },
      },
    });

    while (runIndex < maxRuns) {
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
        });
      }

      const result = await plugin.run(prompt);
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
      if (result.transcript) {
        await onChatLog(result.transcript);
      }

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
    await plugin.stop();
    await rm(workDir, { recursive: true, force: true });
  }
}

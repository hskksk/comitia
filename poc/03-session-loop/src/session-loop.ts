import { judgeContinue, type LoopPhase } from "./continue-judgment.js";
import { readToolLog, type ToolLogEntry } from "./log.js";
import {
  buildRedrivePrompt,
  buildWindDownPrompt,
  INITIAL_PROMPT,
} from "./prompts.js";

export interface EngineRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type EngineRunner = (input: {
  prompt: string;
  runIndex: number;
  phase: LoopPhase;
}) => Promise<EngineRunResult>;

export interface SessionLoopOptions {
  logPath: string;
  maxRuns?: number;
  idleRunLimit?: number;
  runEngine: EngineRunner;
  onRunComplete?: (input: {
    runIndex: number;
    phase: LoopPhase;
    prompt: string;
    result: EngineRunResult;
    decisionReason: string;
  }) => void;
}

export interface SessionLoopResult {
  runs: Array<{
    runIndex: number;
    phase: LoopPhase;
    prompt: string;
    exitCode: number | null;
  }>;
  entries: ToolLogEntry[];
  finalPhase: LoopPhase;
  stopReason: string;
}

function hasEndSession(entries: ToolLogEntry[]): boolean {
  return entries.some(
    (entry) => entry.tool === "end_session" && entry.isError !== true,
  );
}

/** アダプタのセッションループ本体 */
export async function runSessionLoop(
  options: SessionLoopOptions,
): Promise<SessionLoopResult> {
  const maxRuns = options.maxRuns ?? 5;
  const idleRunLimit = options.idleRunLimit ?? 2;

  const runs: SessionLoopResult["runs"] = [];
  let phase: LoopPhase = "work";
  let stopReason = "最大 run 数に到達";
  let runIndex = 0;

  while (runIndex < maxRuns) {
    runIndex += 1;
    const entriesBefore = readToolLog(options.logPath);
    const priorDecision =
      runIndex === 1
        ? null
        : judgeContinue({
            entries: entriesBefore,
            runCount: runIndex - 1,
            maxRuns,
            idleRunLimit,
            windDownRequested: phase === "wind-down",
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

    const result = await options.runEngine({ prompt, runIndex, phase });
    runs.push({ runIndex, phase, prompt, exitCode: result.exitCode });

    const entries = readToolLog(options.logPath);
    const decision = judgeContinue({
      entries,
      runCount: runIndex,
      maxRuns,
      idleRunLimit,
      windDownRequested: phase === "wind-down",
    });

    options.onRunComplete?.({
      runIndex,
      phase,
      prompt,
      result,
      decisionReason: decision.reason,
    });

    if (hasEndSession(entries)) {
      return {
        runs,
        entries,
        finalPhase: "done",
        stopReason: "end_session 完了",
      };
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
      continue;
    }
  }

  const entries = readToolLog(options.logPath);
  return {
    runs,
    entries,
    finalPhase: hasEndSession(entries) ? "done" : phase,
    stopReason,
  };
}

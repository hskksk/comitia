import { allGoalsCompleted, incompleteGoals } from "./goals.js";
import { countTrailingIdleRuns } from "./idle-detection.js";
import { latestRemainingBudget, type ToolLogEntry } from "./log.js";

export type LoopPhase = "work" | "wind-down" | "done";

export interface ContinueDecision {
  phase: LoopPhase;
  shouldContinue: boolean;
  reason: string;
  remainingBudget: number | null;
  incompleteGoalTexts: string[];
}

export interface ContinueJudgmentOptions {
  entries: ToolLogEntry[];
  runCount: number;
  maxRuns: number;
  idleRunLimit: number;
  windDownRequested: boolean;
}

/** run 終了後の継続判定 */
export function judgeContinue(
  options: ContinueJudgmentOptions,
): ContinueDecision {
  const {
    entries,
    runCount,
    maxRuns,
    idleRunLimit,
    windDownRequested,
  } = options;

  const remainingBudget = latestRemainingBudget(entries);
  const incomplete = incompleteGoals(entries);
  const incompleteGoalTexts = incomplete.map((goal) => goal.text);
  const trailingIdle = countTrailingIdleRuns(entries, runCount);

  if (windDownRequested) {
    const hasEndSession = entries.some((entry) => entry.tool === "end_session");
    return {
      phase: hasEndSession ? "done" : "wind-down",
      shouldContinue: !hasEndSession,
      reason: hasEndSession ? "end_session 完了" : "終了作業（end_session）",
      remainingBudget,
      incompleteGoalTexts,
    };
  }

  if (trailingIdle >= idleRunLimit) {
    return {
      phase: "wind-down",
      shouldContinue: true,
      reason: `空転 run が ${trailingIdle} 回連続（上限 ${idleRunLimit}）`,
      remainingBudget,
      incompleteGoalTexts,
    };
  }

  if (allGoalsCompleted(entries)) {
    return {
      phase: "wind-down",
      shouldContinue: true,
      reason: "全目標完了",
      remainingBudget,
      incompleteGoalTexts,
    };
  }

  if (remainingBudget !== null && remainingBudget <= 0) {
    return {
      phase: "wind-down",
      shouldContinue: true,
      reason: "活動量残量 0",
      remainingBudget,
      incompleteGoalTexts,
    };
  }

  if (runCount >= maxRuns) {
    return {
      phase: "wind-down",
      shouldContinue: true,
      reason: `最大 run 数 ${maxRuns} に到達`,
      remainingBudget,
      incompleteGoalTexts,
    };
  }

  if (incomplete.length > 0) {
    return {
      phase: "work",
      shouldContinue: true,
      reason: `未完了目標 ${incomplete.length} 件`,
      remainingBudget,
      incompleteGoalTexts,
    };
  }

  return {
    phase: "wind-down",
    shouldContinue: true,
    reason: "継続理由なし",
    remainingBudget,
    incompleteGoalTexts,
  };
}

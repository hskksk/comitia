import {
  countTrailingIdleRuns,
  type ToolLogEntry,
} from "./idle-detection.js";

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

interface Goal {
  id: string;
  text: string;
  status: "pending" | "completed";
}

function latestRemainingBudget(entries: ToolLogEntry[]): number | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const result = entries[i]?.result;
    if (
      result !== null &&
      typeof result === "object" &&
      "remaining_budget" in result &&
      typeof (result as { remaining_budget: unknown }).remaining_budget ===
        "number"
    ) {
      return (result as { remaining_budget: number }).remaining_budget;
    }
  }
  return null;
}

function parseGoalsFromLog(entries: ToolLogEntry[]): Goal[] {
  for (const entry of entries) {
    if (entry.tool !== "set_goals" || entry.isError) {
      continue;
    }
    const result = entry.result;
    if (
      result !== null &&
      typeof result === "object" &&
      Array.isArray((result as { goals?: unknown }).goals)
    ) {
      return (result as { goals: Goal[] }).goals.map((goal) => ({
        id: goal.id,
        text: goal.text,
        status: goal.status,
      }));
    }
  }
  return [];
}

function resolveGoalState(entries: ToolLogEntry[]): Goal[] {
  const goals = parseGoalsFromLog(entries);
  if (goals.length === 0) {
    return [];
  }

  const completedIds = new Set<string>();
  for (const entry of entries) {
    if (entry.tool !== "complete_goal" || entry.isError) {
      continue;
    }
    const result = entry.result;
    if (
      result !== null &&
      typeof result === "object" &&
      typeof (result as { goal_id?: unknown }).goal_id === "string"
    ) {
      completedIds.add((result as { goal_id: string }).goal_id);
    }
  }

  return goals.map((goal) => ({
    ...goal,
    status: completedIds.has(goal.id) ? "completed" : goal.status,
  }));
}

function incompleteGoals(entries: ToolLogEntry[]): Goal[] {
  return resolveGoalState(entries).filter((goal) => goal.status !== "completed");
}

function allGoalsCompleted(entries: ToolLogEntry[]): boolean {
  const goals = resolveGoalState(entries);
  return goals.length > 0 && goals.every((goal) => goal.status === "completed");
}

/** Decide whether the session loop should continue after a run. */
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

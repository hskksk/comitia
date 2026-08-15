import type { ToolLogEntry } from "./log.js";

/** 目標 1 件 */
export interface Goal {
  id: string;
  text: string;
  status: "pending" | "completed";
}

/** set_goals 呼び出しから目標一覧を復元する */
export function parseGoalsFromLog(entries: ToolLogEntry[]): Goal[] {
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

/** complete_goal 呼び出しを反映した最新の目標状態 */
export function resolveGoalState(entries: ToolLogEntry[]): Goal[] {
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

export function incompleteGoals(entries: ToolLogEntry[]): Goal[] {
  return resolveGoalState(entries).filter((goal) => goal.status !== "completed");
}

export function allGoalsCompleted(entries: ToolLogEntry[]): boolean {
  const goals = resolveGoalState(entries);
  return goals.length > 0 && goals.every((goal) => goal.status === "completed");
}

export function hasSetGoals(entries: ToolLogEntry[]): boolean {
  return parseGoalsFromLog(entries).length > 0;
}

import { describe, expect, it } from "vitest";
import { judgeContinue } from "./continue-judgment.js";
import type { ToolLogEntry } from "./idle-detection.js";

function entry(
  partial: Partial<ToolLogEntry> & { tool: string },
): ToolLogEntry {
  return {
    run: 1,
    args: {},
    ...partial,
  };
}

describe("judgeContinue", () => {
  it("enters wind-down when wind-down is requested without end_session", () => {
    const decision = judgeContinue({
      entries: [],
      runCount: 1,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: true,
    });
    expect(decision).toMatchObject({
      phase: "wind-down",
      shouldContinue: true,
      reason: "終了作業（end_session）",
    });
  });

  it("is done when wind-down is requested and end_session ran", () => {
    const decision = judgeContinue({
      entries: [entry({ tool: "end_session" })],
      runCount: 2,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: true,
    });
    expect(decision).toMatchObject({
      phase: "done",
      shouldContinue: false,
      reason: "end_session 完了",
    });
  });

  it("enters wind-down after consecutive idle runs", () => {
    const decision = judgeContinue({
      entries: [
        entry({
          run: 1,
          tool: "read_thread",
          args: { thread_id: "t1" },
        }),
        entry({
          run: 1,
          tool: "read_thread",
          args: { thread_id: "t1" },
        }),
        entry({
          run: 2,
          tool: "read_thread",
          args: { thread_id: "t1" },
        }),
        entry({
          run: 2,
          tool: "read_thread",
          args: { thread_id: "t1" },
        }),
      ],
      runCount: 2,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision.phase).toBe("wind-down");
    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("空転 run が 2 回連続（上限 2）");
  });

  it("enters wind-down when all goals are completed", () => {
    const decision = judgeContinue({
      entries: [
        entry({
          tool: "set_goals",
          result: {
            goals: [
              { id: "g1", text: "typo", status: "pending" },
              { id: "g2", text: "report", status: "pending" },
            ],
          },
        }),
        entry({ tool: "complete_goal", result: { goal_id: "g1" } }),
        entry({ tool: "complete_goal", result: { goal_id: "g2" } }),
      ],
      runCount: 1,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision).toMatchObject({
      phase: "wind-down",
      shouldContinue: true,
      reason: "全目標完了",
    });
  });

  it("enters wind-down when remaining budget is 0", () => {
    const decision = judgeContinue({
      entries: [entry({ tool: "post", result: { remaining_budget: 0 } })],
      runCount: 1,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision).toMatchObject({
      phase: "wind-down",
      shouldContinue: true,
      reason: "活動量残量 0",
      remainingBudget: 0,
    });
  });

  it("enters wind-down when max runs is reached", () => {
    const decision = judgeContinue({
      entries: [entry({ run: 8, tool: "post", result: { remaining_budget: 50 } })],
      runCount: 8,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision).toMatchObject({
      phase: "wind-down",
      shouldContinue: true,
      reason: "最大 run 数 8 に到達",
    });
  });

  it("stays in work (not wind-down) when goals were never declared and idle limit isn't reached", () => {
    const decision = judgeContinue({
      entries: [entry({ tool: "get_briefing", result: { remaining_budget: 1000 } })],
      runCount: 1,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision).toMatchObject({
      phase: "work",
      shouldContinue: true,
      reason: "目標未宣言",
      goalsEverSet: false,
    });
  });

  it("still winds down via the idle path when goals are never declared and idle limit is reached", () => {
    const decision = judgeContinue({
      entries: [
        entry({ run: 1, tool: "read_thread", args: { thread_id: "t1" } }),
        entry({ run: 1, tool: "read_thread", args: { thread_id: "t1" } }),
        entry({ run: 2, tool: "read_thread", args: { thread_id: "t1" } }),
        entry({ run: 2, tool: "read_thread", args: { thread_id: "t1" } }),
      ],
      runCount: 2,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision).toMatchObject({
      phase: "wind-down",
      shouldContinue: true,
      goalsEverSet: false,
    });
  });

  it("marks goalsEverSet true once set_goals has succeeded, even after all goals complete", () => {
    const decision = judgeContinue({
      entries: [
        entry({
          tool: "set_goals",
          result: { goals: [{ id: "g1", text: "typo", status: "pending" }] },
        }),
        entry({ tool: "complete_goal", result: { goal_id: "g1" } }),
      ],
      runCount: 1,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision.goalsEverSet).toBe(true);
  });

  it("continues work when incomplete goals remain", () => {
    const decision = judgeContinue({
      entries: [
        entry({
          tool: "set_goals",
          result: {
            remaining_budget: 90,
            goals: [
              { id: "g1", text: "typo", status: "pending" },
              { id: "g2", text: "report", status: "pending" },
            ],
          },
        }),
        entry({ tool: "complete_goal", result: { goal_id: "g1" } }),
      ],
      runCount: 1,
      maxRuns: 8,
      idleRunLimit: 2,
      windDownRequested: false,
    });
    expect(decision).toMatchObject({
      phase: "work",
      shouldContinue: true,
      reason: "未完了目標 1 件",
      incompleteGoalTexts: ["report"],
    });
  });
});

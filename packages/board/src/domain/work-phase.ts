import type { WorkPhase } from "@comitia/shared";

const WORK_THREAD_TYPES = new Set(["implementation", "review"]);

export function deriveWorkPhase(input: {
  threadType: string;
  threadState: string;
  hasActiveClaim: boolean;
  pullRequestStates: readonly string[];
}): WorkPhase | null {
  if (
    !WORK_THREAD_TYPES.has(input.threadType) ||
    input.threadState !== "decided"
  ) {
    return null;
  }
  const states = new Set(input.pullRequestStates);
  if (states.has("open")) {
    return "in_review";
  }
  if (states.has("merged")) {
    return "merged";
  }
  if (input.hasActiveClaim) {
    return "in_progress";
  }
  return "unclaimed";
}

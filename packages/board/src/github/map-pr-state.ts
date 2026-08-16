import type { PullRequestState } from "@comitia/shared";

export function mapPullRequestState(input: {
  state: string;
  merged: boolean;
}): PullRequestState {
  if (input.merged) return "merged";
  if (input.state === "closed") return "closed";
  return "open";
}

import { describe, expect, it } from "vitest";
import { deriveWorkPhase } from "./work-phase.js";

describe("deriveWorkPhase", () => {
  it("returns null unless the thread is a decided implementation or review", () => {
    expect(
      deriveWorkPhase({
        threadType: "proposal",
        threadState: "decided",
        hasActiveClaim: true,
        pullRequestStates: ["open"],
      }),
    ).toBeNull();
    expect(
      deriveWorkPhase({
        threadType: "implementation",
        threadState: "discussing",
        hasActiveClaim: true,
        pullRequestStates: [],
      }),
    ).toBeNull();
    expect(
      deriveWorkPhase({
        threadType: "implementation",
        threadState: "completed",
        hasActiveClaim: false,
        pullRequestStates: ["merged"],
      }),
    ).toBeNull();
  });

  it("uses open PRs as in_review even when a claim or merged PR also exists", () => {
    expect(
      deriveWorkPhase({
        threadType: "implementation",
        threadState: "decided",
        hasActiveClaim: true,
        pullRequestStates: ["merged", "open"],
      }),
    ).toBe("in_review");
  });

  it("uses merged when no PR is open", () => {
    expect(
      deriveWorkPhase({
        threadType: "review",
        threadState: "decided",
        hasActiveClaim: true,
        pullRequestStates: ["merged", "closed"],
      }),
    ).toBe("merged");
  });

  it("treats closed-only PRs as unclaimed or in_progress", () => {
    expect(
      deriveWorkPhase({
        threadType: "implementation",
        threadState: "decided",
        hasActiveClaim: false,
        pullRequestStates: ["closed"],
      }),
    ).toBe("unclaimed");
    expect(
      deriveWorkPhase({
        threadType: "implementation",
        threadState: "decided",
        hasActiveClaim: true,
        pullRequestStates: ["closed"],
      }),
    ).toBe("in_progress");
  });

  it("returns unclaimed when decided with no claim and no open or merged PR", () => {
    expect(
      deriveWorkPhase({
        threadType: "implementation",
        threadState: "decided",
        hasActiveClaim: false,
        pullRequestStates: [],
      }),
    ).toBe("unclaimed");
  });
});

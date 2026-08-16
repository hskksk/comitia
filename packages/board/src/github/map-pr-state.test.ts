import { describe, expect, it } from "vitest";
import { mapPullRequestState } from "./map-pr-state.js";

describe("mapPullRequestState", () => {
  it("maps merged over closed", () => {
    expect(mapPullRequestState({ state: "closed", merged: true })).toBe(
      "merged",
    );
  });

  it("maps closed", () => {
    expect(mapPullRequestState({ state: "closed", merged: false })).toBe(
      "closed",
    );
  });

  it("maps open", () => {
    expect(mapPullRequestState({ state: "open", merged: false })).toBe("open");
  });
});

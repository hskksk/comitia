import { describe, expect, it } from "vitest";
import { THREAD_STATES, THREAD_TYPES, canCompleteThread } from "./constants.js";

describe("canCompleteThread", () => {
  it("allows decided threads of every type except brainstorm", () => {
    for (const type of THREAD_TYPES) {
      if (type === "brainstorm") {
        continue;
      }
      expect(canCompleteThread({ type, state: "decided" })).toBe(true);
    }
  });

  it("allows brainstorm only while discussing", () => {
    expect(
      canCompleteThread({ type: "brainstorm", state: "discussing" }),
    ).toBe(true);
    for (const state of THREAD_STATES) {
      if (state === "discussing") {
        continue;
      }
      expect(canCompleteThread({ type: "brainstorm", state })).toBe(false);
    }
  });

  it("rejects non-decided states for consensus thread types", () => {
    for (const type of ["consultation", "proposal", "implementation", "review"] as const) {
      for (const state of THREAD_STATES) {
        if (state === "decided") {
          continue;
        }
        expect(canCompleteThread({ type, state })).toBe(false);
      }
    }
  });
});

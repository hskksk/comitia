import { describe, expect, it } from "vitest";
import { joinSystemPrompt } from "../environment-prompt.js";
import { bayInstructions } from "./bay-engine.js";
import { TOOLSET_OVERVIEW } from "./tool-catalog.js";

describe("bayInstructions", () => {
  it("is empty when the environment prompt is empty", () => {
    expect(bayInstructions("")).toBe("");
    expect(bayInstructions()).toBe("");
    expect(bayInstructions("")).not.toContain("朝 → 作業");
  });

  it("joins a non-empty environment prompt with TOOLSET_OVERVIEW", () => {
    expect(bayInstructions("env-layer")).toBe(
      joinSystemPrompt("env-layer", TOOLSET_OVERVIEW),
    );
  });
});

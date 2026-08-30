import { describe, expect, it } from "vitest";
import { PERSONALITY_MAX_LENGTH, PERSONALITY_PRESETS } from "./constants.js";

describe("personality presets", () => {
  it("stays within the personality length cap", () => {
    for (const preset of PERSONALITY_PRESETS) {
      expect([...preset.body].length).toBeLessThanOrEqual(PERSONALITY_MAX_LENGTH);
      expect(preset.body.trim()).toBe(preset.body);
    }
  });

  it("uses unique ids", () => {
    const ids = PERSONALITY_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

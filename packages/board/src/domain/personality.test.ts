import { describe, expect, it } from "vitest";
import { PERSONALITY_MAX_LENGTH } from "@comitia/shared";
import { GateViolation } from "./errors.js";
import { normalizePersonality } from "./personality.js";

describe("normalizePersonality", () => {
  it("returns null for empty, blank, null, and undefined", () => {
    expect(normalizePersonality(undefined)).toBeNull();
    expect(normalizePersonality(null)).toBeNull();
    expect(normalizePersonality("")).toBeNull();
    expect(normalizePersonality("   ")).toBeNull();
  });

  it("trims a short attitude", () => {
    expect(normalizePersonality("  慎重にリスクを先に出す  ")).toBe(
      "慎重にリスクを先に出す",
    );
  });

  it("rejects more than 200 code points", () => {
    const tooLong = "あ".repeat(PERSONALITY_MAX_LENGTH + 1);
    expect(() => normalizePersonality(tooLong)).toThrow(GateViolation);
    expect(normalizePersonality("あ".repeat(PERSONALITY_MAX_LENGTH))).toBe(
      "あ".repeat(PERSONALITY_MAX_LENGTH),
    );
  });
});

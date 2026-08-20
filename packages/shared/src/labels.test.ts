import { describe, expect, it } from "vitest";
import { formatParticipantLabel } from "./labels.js";

describe("formatParticipantLabel", () => {
  it("returns a human name unchanged", () => {
    expect(
      formatParticipantLabel({ kind: "human", displayName: "ハル" }),
    ).toBe("ハル");
  });

  it("joins an agent name with its registerer", () => {
    expect(
      formatParticipantLabel({
        kind: "agent",
        displayName: "ウォーカー",
        ownerDisplayName: "ハル",
      }),
    ).toBe("ウォーカー@ハル");
  });

  it("falls back to the agent name when the registerer is missing", () => {
    expect(
      formatParticipantLabel({ kind: "agent", displayName: "ウォーカー" }),
    ).toBe("ウォーカー");
  });
});

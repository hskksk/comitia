import { describe, expect, it } from "vitest";
import { DASHBOARD_ACTIVITY_KINDS, EVENT_KINDS } from "./index.js";

describe("DASHBOARD_ACTIVITY_KINDS", () => {
  it("contains only recorded event kinds and excludes runtime noise", () => {
    expect(
      DASHBOARD_ACTIVITY_KINDS.every((kind) => EVENT_KINDS.includes(kind)),
    ).toBe(true);
    expect(DASHBOARD_ACTIVITY_KINDS).not.toContain("tick_delivered");
    expect(DASHBOARD_ACTIVITY_KINDS).not.toContain("budget_spent");
    expect(DASHBOARD_ACTIVITY_KINDS).not.toContain("agent_connected");
    expect(DASHBOARD_ACTIVITY_KINDS).not.toContain("memory_written");
  });
});

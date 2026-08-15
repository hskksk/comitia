import { describe, expect, it } from "vitest";
import { createTick, parseTickFromMetadata } from "./tick.js";

describe("tick", () => {
  it("creates a thin tick with id, type, issuedAt", () => {
    const tick = createTick("session.start", { sessionId: "sess-1" });
    expect(tick.type).toBe("session.start");
    expect(tick.sessionId).toBe("sess-1");
    expect(tick.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(Number.isNaN(Date.parse(tick.issuedAt))).toBe(false);
  });

  it("round-trips through A2A metadata", () => {
    const tick = createTick("nudge");
    const parsed = parseTickFromMetadata({
      tickId: tick.id,
      tickType: tick.type,
      issuedAt: tick.issuedAt,
      sessionId: tick.sessionId,
    });
    expect(parsed).toEqual(tick);
  });

  it("returns null for unknown tick types", () => {
    expect(
      parseTickFromMetadata({
        tickId: "x",
        tickType: "nope",
        issuedAt: new Date().toISOString(),
      }),
    ).toBeNull();
  });
});

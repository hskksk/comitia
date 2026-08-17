import { describe, expect, it } from "vitest";
import { formatRelativeTimeJa } from "./relativeTime.js";

describe("formatRelativeTimeJa", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");

  it("formats hours ago in Japanese", () => {
    expect(formatRelativeTimeJa("2026-08-17T09:00:00.000Z", now)).toBe(
      "3時間前",
    );
  });

  it("formats minutes ago", () => {
    expect(formatRelativeTimeJa("2026-08-17T11:45:00.000Z", now)).toBe(
      "15分前",
    );
  });
});

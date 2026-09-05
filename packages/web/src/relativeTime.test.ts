import { describe, expect, it } from "vitest";
import { formatRelativeTimeJa, formatTraceClock } from "./relativeTime.js";

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

describe("formatTraceClock", () => {
  it("formats a UTC timestamp as HH:mm:ss", () => {
    expect(formatTraceClock("2026-08-31T11:23:05.118Z", "UTC")).toBe("11:23:05");
  });

  it("returns invalid values unchanged", () => {
    expect(formatTraceClock("not-a-date")).toBe("not-a-date");
  });
});

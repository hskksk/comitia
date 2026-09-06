import { describe, expect, it } from "vitest";
import { sortThreadPostsByCreatedAtDesc } from "./threadPostView.js";

describe("sortThreadPostsByCreatedAtDesc", () => {
  it("orders by createdAt descending", () => {
    const sorted = sortThreadPostsByCreatedAtDesc([
      { id: "a", createdAt: "2026-08-16T00:00:00.000Z" },
      { id: "b", createdAt: "2026-08-16T03:00:00.000Z" },
      { id: "c", createdAt: "2026-08-16T01:00:00.000Z" },
    ]);
    expect(sorted.map((post) => post.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by id descending", () => {
    const sorted = sortThreadPostsByCreatedAtDesc([
      { id: "a", createdAt: "2026-08-16T00:00:00.000Z" },
      { id: "c", createdAt: "2026-08-16T00:00:00.000Z" },
      { id: "b", createdAt: "2026-08-16T00:00:00.000Z" },
    ]);
    expect(sorted.map((post) => post.id)).toEqual(["c", "b", "a"]);
  });
});

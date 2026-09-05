import { describe, expect, it } from "vitest";
import type { ThreadListItem } from "./api.js";
import { visibleThreadListItems } from "./threadListView.js";

function item(
  overrides: Partial<ThreadListItem> & Pick<ThreadListItem, "id" | "title">,
): ThreadListItem {
  return {
    type: "consultation",
    state: "discussing",
    consensusType: null,
    ownerParticipantId: "p1",
    createdAt: "2026-09-01T00:00:00.000Z",
    lastEventAt: "2026-09-01T00:00:00.000Z",
    activeWorkClaimants: [],
    ...overrides,
  };
}

describe("visibleThreadListItems", () => {
  const items = [
    item({
      id: "old",
      title: "いの古いスレッド",
      createdAt: "2026-09-01T00:00:00.000Z",
      lastEventAt: "2026-09-04T00:00:00.000Z",
    }),
    item({
      id: "done",
      title: "完了した作業",
      type: "implementation",
      state: "completed",
      createdAt: "2026-09-03T00:00:00.000Z",
      lastEventAt: "2026-09-05T00:00:00.000Z",
    }),
    item({
      id: "new",
      title: "あたらしい相談",
      createdAt: "2026-09-02T00:00:00.000Z",
      lastEventAt: "2026-09-02T00:00:00.000Z",
      ownerParticipantId: "p2",
    }),
  ];

  it("hides completed threads by default sort of latest event", () => {
    expect(
      visibleThreadListItems(items, {
        filter: "all",
        sort: "latest_event",
        hideCompleted: true,
        meId: "p1",
      }).map((row) => row.id),
    ).toEqual(["old", "new"]);
  });

  it("includes completed threads when hideCompleted is false", () => {
    expect(
      visibleThreadListItems(items, {
        filter: "all",
        sort: "latest_event",
        hideCompleted: false,
        meId: "p1",
      }).map((row) => row.id),
    ).toEqual(["done", "old", "new"]);
  });

  it("sorts by createdAt descending", () => {
    expect(
      visibleThreadListItems(items, {
        filter: "all",
        sort: "created_at",
        hideCompleted: false,
        meId: "p1",
      }).map((row) => row.id),
    ).toEqual(["done", "new", "old"]);
  });

  it("sorts by title", () => {
    expect(
      visibleThreadListItems(items, {
        filter: "all",
        sort: "title",
        hideCompleted: false,
        meId: "p1",
      }).map((row) => row.title),
    ).toEqual(["あたらしい相談", "いの古いスレッド", "完了した作業"]);
  });

  it("keeps type and owner filters after excluding completed", () => {
    expect(
      visibleThreadListItems(items, {
        filter: "implementation",
        sort: "latest_event",
        hideCompleted: true,
        meId: "p1",
      }),
    ).toEqual([]);
    expect(
      visibleThreadListItems(items, {
        filter: "mine",
        sort: "latest_event",
        hideCompleted: true,
        meId: "p1",
      }).map((row) => row.id),
    ).toEqual(["old"]);
  });
});

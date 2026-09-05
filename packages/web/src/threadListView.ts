import type { ThreadListItem } from "./api.js";

export type ThreadListFilter = "all" | "mine" | "proposal" | "implementation";

export const THREAD_LIST_SORTS = [
  "latest_event",
  "created_at",
  "title",
] as const;
export type ThreadListSort = (typeof THREAD_LIST_SORTS)[number];

export const DEFAULT_THREAD_LIST_SORT: ThreadListSort = "latest_event";

export function visibleThreadListItems(
  items: ThreadListItem[],
  options: {
    filter: ThreadListFilter;
    sort: ThreadListSort;
    hideCompleted: boolean;
    meId: string | null;
  },
): ThreadListItem[] {
  const filtered = items.filter((item) => {
    if (options.hideCompleted && item.state === "completed") {
      return false;
    }
    if (options.filter === "mine") {
      return options.meId !== null && item.ownerParticipantId === options.meId;
    }
    if (options.filter === "proposal" || options.filter === "implementation") {
      return item.type === options.filter;
    }
    return true;
  });
  return [...filtered].sort((a, b) => compareThreadListItems(a, b, options.sort));
}

function compareThreadListItems(
  a: ThreadListItem,
  b: ThreadListItem,
  sort: ThreadListSort,
): number {
  if (sort === "title") {
    return a.title.localeCompare(b.title, "ja") || b.createdAt.localeCompare(a.createdAt);
  }
  if (sort === "created_at") {
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  }
  return (
    b.lastEventAt.localeCompare(a.lastEventAt) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

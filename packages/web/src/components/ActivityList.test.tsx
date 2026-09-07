import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityItem } from "../api.js";
import { ActivityList } from "./ActivityList.js";

const declarations = [
  ["select_candidate", "候補選定"],
  ["declare_rough", "概略合意"],
  ["owner_decide", "オーナー決定"],
  ["request_ratification", "批准依頼"],
  ["ratify", "批准"],
  ["send_back", "差し戻し"],
  ["reject_thread", "不採用"],
  ["complete_thread", "完了"],
  ["extend_window", "判断期間延長"],
  ["shorten_window", "判断期間短縮"],
  ["clock_satisfy", "判断期間成立"],
] as const;

function declarationItem(
  declarationKind: (typeof declarations)[number][0],
  id: number,
): ActivityItem {
  return {
    id,
    kind: "thread_declaration",
    actor: { id: "agent-1", displayName: "ミカ@ハル", kind: "agent" },
    subject: {
      type: "thread",
      id: "thread-1",
      title: "認証方式",
      href: "/p/project-1/threads/thread-1",
    },
    detail: {
      type: "declaration",
      declarationKind,
      proposalId: null,
      proposalNumber: null,
      versionNumber: null,
      summary: null,
      reason: null,
      hours: null,
    },
    createdAt: "2026-09-07T12:00:00.000Z",
  };
}

describe("ActivityList", () => {
  afterEach(cleanup);

  it("renders every declaration kind in Japanese", () => {
    render(
      <MemoryRouter>
        <ActivityList
          items={declarations.map(([kind], index) =>
            declarationItem(kind, index),
          )}
        />
      </MemoryRouter>,
    );

    const list = screen.getByRole("list");
    for (const [raw, label] of declarations) {
      expect(list).toHaveTextContent(label);
      expect(list).not.toHaveTextContent(raw);
    }
  });

  it("uses the safe fallback for an unknown runtime kind", () => {
    const unknownItem = {
      id: 1,
      kind: "future_internal_event",
      actor: null,
      subject: {
        type: "project",
        id: "project-1",
        name: "comitia",
        href: "/p/project-1",
      },
      detail: { type: "future" },
      createdAt: "2026-09-07T12:00:00.000Z",
    } as unknown as ActivityItem;

    render(
      <MemoryRouter>
        <ActivityList items={[unknownItem]} />
      </MemoryRouter>,
    );

    expect(screen.getByText("プロジェクトが更新されました")).toBeInTheDocument();
    expect(screen.queryByText("future_internal_event")).not.toBeInTheDocument();
  });
});

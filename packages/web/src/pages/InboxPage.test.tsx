import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InboxPage } from "./InboxPage.js";

const declareMock = vi.fn().mockResolvedValue({ thread: { state: "completed" } });
const inboxMock = vi
  .fn()
  .mockResolvedValueOnce({
    items: [
      {
        threadId: "t-impl",
        title: "typo 修正",
        type: "implementation",
        kind: "merge_wait",
        decidedAt: "2026-08-16T00:00:00.000Z",
        latestReport: null,
      },
    ],
  })
  .mockResolvedValueOnce({ items: [] });

vi.mock("../api.js", () => ({
  boardClient: {
    inbox: (...args: unknown[]) => inboxMock(...args),
    declare: (...args: unknown[]) => declareMock(...args),
  },
}));

describe("InboxPage", () => {
  it("completes a merge-wait item", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("typo 修正")).toBeInTheDocument();
    expect(screen.getByText("マージ待ち")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "完了にする" }));
    expect(declareMock).toHaveBeenCalledWith("t-impl", {
      kind: "complete_thread",
    });
    expect(await screen.findByText("非ブロッキングな作業はありません")).toBeInTheDocument();
  });
});

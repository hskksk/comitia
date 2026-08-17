import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadPage } from "./ThreadPage.js";

const threadView = {
  thread: {
    id: "t1",
    title: "ルール改正",
    type: "proposal",
    state: "awaiting_decision",
    consensusType: "human_ratification",
    humanRequired: false,
    ownerParticipantId: "p1",
    projectId: "proj",
  },
  synthesis: {
    id: "s1",
    body: "争点は遡及",
    createdAt: "2026-08-16T00:00:00.000Z",
  },
  candidateProposal: {
    id: "v1",
    versionNumber: 1,
    content: "区分を導入する",
  },
  posts: [
    {
      id: "post-1",
      type: "synthesis",
      body: "争点は遡及",
      rationale: null,
      authorParticipantId: "a1",
      authorDisplayName: "ミカ",
      createdAt: "2026-08-16T00:00:00.000Z",
    },
  ],
  pullRequests: [],
};

const declareMock = vi.fn().mockResolvedValue({ thread: { state: "decided" } });
const threadMock = vi.fn().mockResolvedValue(threadView);

vi.mock("../api.js", () => ({
  boardClient: {
    thread: (...args: unknown[]) => threadMock(...args),
    declare: (...args: unknown[]) => declareMock(...args),
  },
}));

function renderThread() {
  return render(
    <MemoryRouter initialEntries={["/threads/t1"]}>
      <Routes>
        <Route path="/threads/:id" element={<ThreadPage />} />
        <Route path="/" element={<p>queue-home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ThreadPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    declareMock.mockClear();
    declareMock.mockResolvedValue({ thread: { state: "decided" } });
    threadMock.mockClear();
    threadMock.mockResolvedValue(threadView);
  });

  it("ratifies with summary", async () => {
    const user = userEvent.setup();
    renderThread();
    expect((await screen.findAllByText("争点は遡及")).length).toBeGreaterThan(0);
    expect(screen.getByText("提案")).toBeInTheDocument();
    expect(screen.getByText("判断待ち")).toBeInTheDocument();
    expect(screen.getByText("人間による批准")).toBeInTheDocument();
    expect(screen.getByText("統合")).toBeInTheDocument();
    await user.type(screen.getByLabelText("要約"), "批准する");
    await user.click(screen.getByRole("button", { name: "批准する" }));
    expect(declareMock).toHaveBeenCalledWith("t1", {
      kind: "ratify",
      binding: true,
      summary: "批准する",
    });
  });

  it("stays on the thread after ratify and shows a queue link", async () => {
    const user = userEvent.setup();
    const decidedView = {
      ...threadView,
      thread: { ...threadView.thread, state: "decided" },
    };
    threadMock
      .mockResolvedValueOnce(threadView)
      .mockResolvedValueOnce(decidedView);

    renderThread();
    await screen.findByText("ルール改正");
    await user.type(screen.getByLabelText("要約"), "批准する");
    await user.click(screen.getByRole("button", { name: "批准する" }));

    await waitFor(() => expect(threadMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("queue-home")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "判断キューへ" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.queryByRole("button", { name: "批准する" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("決定済み")).toBeInTheDocument();
  });

  it("sends back with the entered reason", async () => {
    const user = userEvent.setup();
    renderThread();

    await screen.findByText("ルール改正");
    await user.type(screen.getByLabelText("差し戻し理由"), "影響範囲を明確にしてください");
    await user.click(screen.getByRole("button", { name: "差し戻す" }));

    expect(declareMock).toHaveBeenCalledWith("t1", {
      kind: "send_back",
      reason: "影響範囲を明確にしてください",
    });
  });

  it("does not send back when reason is empty", async () => {
    const user = userEvent.setup();
    renderThread();

    await screen.findByText("ルール改正");
    expect(screen.getByRole("button", { name: "差し戻す" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "差し戻す" }));
    expect(declareMock).not.toHaveBeenCalled();
  });

  it("rejects only after in-page confirmation", async () => {
    const user = userEvent.setup();
    renderThread();

    await screen.findByText("ルール改正");
    await user.type(screen.getByLabelText("要約"), "現時点では不採用");
    await user.click(screen.getByRole("button", { name: "不採用" }));

    expect(declareMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("不採用にする。このスレッドは閉じる"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "不採用を確定" }));

    expect(declareMock).toHaveBeenCalledWith("t1", {
      kind: "reject_thread",
      summary: "現時点では不採用",
    });
  });

  it("cancels reject confirmation without declaring", async () => {
    const user = userEvent.setup();
    renderThread();

    await screen.findByText("ルール改正");
    await user.type(screen.getByLabelText("要約"), "現時点では不採用");
    await user.click(screen.getByRole("button", { name: "不採用" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(declareMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText("不採用にする。このスレッドは閉じる"),
    ).not.toBeInTheDocument();
  });

  it("disables every declaration action while a declaration is in flight", async () => {
    const user = userEvent.setup();
    declareMock.mockImplementationOnce(() => new Promise(() => undefined));
    renderThread();

    await screen.findByText("ルール改正");
    await user.type(screen.getByLabelText("要約"), "批准する");
    await user.click(screen.getByRole("button", { name: "批准する" }));

    expect(screen.getByRole("button", { name: "批准する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "差し戻す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "不採用" })).toBeDisabled();
  });

  it.each(["implementation", "review"] as const)(
    "shows and completes decided %s threads",
    async (type) => {
      const user = userEvent.setup();
      threadMock.mockResolvedValue({
        ...threadView,
        thread: { ...threadView.thread, type, state: "decided" },
      });
      renderThread();

      await screen.findByText("ルール改正");
      await user.click(screen.getByRole("button", { name: "完了にする" }));

      expect(declareMock).toHaveBeenCalledWith("t1", {
        kind: "complete_thread",
      });
    },
  );

  it("does not show completion for the awaiting-decision fixture", async () => {
    renderThread();

    await screen.findByText("ルール改正");

    expect(
      screen.queryByRole("button", { name: "完了にする" }),
    ).not.toBeInTheDocument();
  });

  it("disables completion while a declaration is in flight", async () => {
    const user = userEvent.setup();
    threadMock.mockResolvedValue({
      ...threadView,
      thread: {
        ...threadView.thread,
        type: "implementation",
        state: "decided",
      },
    });
    declareMock.mockImplementationOnce(() => new Promise(() => undefined));
    renderThread();

    await screen.findByText("ルール改正");
    await user.click(screen.getByRole("button", { name: "完了にする" }));

    expect(screen.getByRole("button", { name: "完了にする" })).toBeDisabled();
  });
});

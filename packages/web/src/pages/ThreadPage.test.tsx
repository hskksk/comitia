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
    awaitingEnteredAt: null,
    timingEndsAt: null,
  },
  consensusReasons: [],
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
  proposals: [],
  pullRequests: [],
  workClaims: [],
};

const declareMock = vi.fn().mockResolvedValue({ thread: { state: "decided" } });
const threadMock = vi.fn().mockResolvedValue(threadView);
const meMock = vi.fn().mockResolvedValue({
  participant: { id: "p1", kind: "human", displayName: "ハル" },
  projectId: "proj",
});
const addPostMock = vi.fn().mockResolvedValue({ id: "post-2" });
const addProposalMock = vi.fn().mockResolvedValue({
  id: "prop-1",
  number: 1,
  latestVersionId: "v2",
  versionNumber: 1,
  content: "案",
});
const claimWorkMock = vi.fn().mockResolvedValue({
  id: "claim-1",
  threadId: "t1",
  paths: ["docs/"],
  overlaps: [],
});
const releaseWorkMock = vi.fn().mockResolvedValue({ id: "claim-1", active: false });

vi.mock("../api.js", () => ({
  boardClient: {
    thread: (...args: unknown[]) => threadMock(...args),
    declare: (...args: unknown[]) => declareMock(...args),
    me: (...args: unknown[]) => meMock(...args),
    addPost: (...args: unknown[]) => addPostMock(...args),
    addProposal: (...args: unknown[]) => addProposalMock(...args),
    claimWork: (...args: unknown[]) => claimWorkMock(...args),
    releaseWork: (...args: unknown[]) => releaseWorkMock(...args),
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
    meMock.mockClear();
    meMock.mockResolvedValue({
      participant: { id: "p1", kind: "human", displayName: "ハル" },
      projectId: "proj",
    });
    addPostMock.mockClear();
    addProposalMock.mockClear();
    claimWorkMock.mockClear();
    claimWorkMock.mockResolvedValue({
      id: "claim-1",
      threadId: "t1",
      paths: ["docs/"],
      overlaps: [],
    });
    releaseWorkMock.mockClear();
    releaseWorkMock.mockResolvedValue({ id: "claim-1", active: false });
  });

  it("ratifies with summary", async () => {
    const user = userEvent.setup();
    renderThread();
    expect((await screen.findAllByText("争点は遡及")).length).toBeGreaterThan(0);
    expect(screen.getByText("提案")).toBeInTheDocument();
    expect(screen.getByText("判断待ち")).toBeInTheDocument();
    expect(screen.getByText("人間による批准")).toBeInTheDocument();
    expect(screen.getAllByText("統合").length).toBeGreaterThan(0);
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

  it("posts a comment from the composer", async () => {
    const user = userEvent.setup();
    addPostMock.mockResolvedValue({ id: "post-2" });
    threadMock
      .mockResolvedValueOnce(threadView)
      .mockResolvedValueOnce({
        ...threadView,
        posts: [
          ...threadView.posts,
          {
            id: "post-2",
            type: "comment",
            body: "人間からのコメント",
            rationale: null,
            authorParticipantId: "p1",
            authorDisplayName: "ハル",
            createdAt: "2026-08-16T01:00:00.000Z",
          },
        ],
      });
    renderThread();
    await screen.findByText("ルール改正");
    await user.type(screen.getByLabelText("本文"), "人間からのコメント");
    await user.click(screen.getByRole("button", { name: "投稿する" }));
    expect(addPostMock).toHaveBeenCalledWith("t1", {
      type: "comment",
      body: "人間からのコメント",
      rationale: undefined,
      blocking: undefined,
      proposalVersionId: undefined,
    });
  });

  it("lets the thread owner select a candidate while discussing", async () => {
    const user = userEvent.setup();
    threadMock.mockResolvedValue({
      ...threadView,
      thread: { ...threadView.thread, state: "discussing" },
      proposals: [
        {
          id: "prop-1",
          number: 1,
          latestVersionId: "v1",
          versionNumber: 1,
          content: "区分を導入する",
        },
      ],
    });
    renderThread();
    await screen.findByText("ルール改正");
    await user.click(screen.getByRole("button", { name: "これを候補にする" }));
    expect(declareMock).toHaveBeenCalledWith("t1", {
      kind: "select_candidate",
      proposalVersionId: "v1",
    });
  });

  it("submits a work claim with one path per line", async () => {
    const user = userEvent.setup();
    renderThread();
    await screen.findByText("ルール改正");

    await user.type(
      screen.getByLabelText('paths（1 行 1 件。全部なら "."）'),
      "docs/\npackages/web/src/labels.ts",
    );
    await user.click(screen.getByRole("button", { name: "着手を表明" }));

    expect(claimWorkMock).toHaveBeenCalledWith("t1", [
      "docs/",
      "packages/web/src/labels.ts",
    ]);
  });

  it("shows a release button for the current user's own claim", async () => {
    const user = userEvent.setup();
    threadMock.mockResolvedValue({
      ...threadView,
      workClaims: [
        {
          id: "claim-1",
          participantId: "p1",
          displayName: "ハル",
          paths: ["docs/"],
          createdAt: "2026-08-16T00:00:00.000Z",
        },
        {
          id: "claim-2",
          participantId: "other",
          displayName: "ミカ",
          paths: ["packages/"],
          createdAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    });
    renderThread();
    await screen.findByText("ルール改正");

    expect(screen.getByText(/ハル: docs\//)).toBeInTheDocument();
    expect(screen.getByText(/ミカ: packages\//)).toBeInTheDocument();
    const releaseButtons = screen.getAllByRole("button", { name: "解除" });
    expect(releaseButtons).toHaveLength(1);

    await user.click(releaseButtons[0]!);
    expect(releaseWorkMock).toHaveBeenCalledWith("t1", "claim-1");
  });
});

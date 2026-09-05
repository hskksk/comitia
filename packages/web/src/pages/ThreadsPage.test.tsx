import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadsPage } from "./ThreadsPage.js";

const threadsMock = vi.fn();
const meMock = vi.fn();

vi.mock("../api.js", () => ({
  boardClient: {
    threads: (...args: unknown[]) => threadsMock(...args),
    me: (...args: unknown[]) => meMock(...args),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/p/proj-1/threads"]}>
      <Routes>
        <Route path="/p/:projectId/threads" element={<ThreadsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ThreadsPage", () => {
  afterEach(cleanup);

  it("hides completed threads by default and can show them", async () => {
    const user = userEvent.setup();
    threadsMock.mockResolvedValue({
      items: [
        {
          id: "open",
          title: "進行中の相談",
          type: "consultation",
          state: "discussing",
          consensusType: null,
          ownerParticipantId: "p1",
          createdAt: "2026-09-01T00:00:00.000Z",
          lastEventAt: "2026-09-02T00:00:00.000Z",
          activeWorkClaimants: [],
        },
        {
          id: "done",
          title: "終わった実装",
          type: "implementation",
          state: "completed",
          consensusType: "owner_decision",
          ownerParticipantId: "p1",
          createdAt: "2026-09-03T00:00:00.000Z",
          lastEventAt: "2026-09-04T00:00:00.000Z",
          activeWorkClaimants: [],
        },
      ],
    });
    meMock.mockResolvedValue({
      participant: { id: "p1", kind: "human", displayName: "ハル" },
      projectId: "proj-1",
    });

    renderPage();

    expect(await screen.findByText("進行中の相談")).toBeInTheDocument();
    expect(screen.queryByText("終わった実装")).not.toBeInTheDocument();
    expect(screen.getByText("完了したスレッドは非表示です。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完了を除く" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "完了も表示" }));
    expect(screen.getByText("終わった実装")).toBeInTheDocument();
    expect(
      screen.queryByText("完了したスレッドは非表示です。"),
    ).not.toBeInTheDocument();
  });

  it("reorders threads when the sort changes", async () => {
    const user = userEvent.setup();
    threadsMock.mockResolvedValue({
      items: [
        {
          id: "alpha",
          title: "あいう",
          type: "consultation",
          state: "discussing",
          consensusType: null,
          ownerParticipantId: "p1",
          createdAt: "2026-09-01T00:00:00.000Z",
          lastEventAt: "2026-09-05T00:00:00.000Z",
          activeWorkClaimants: [],
        },
        {
          id: "beta",
          title: "かきく",
          type: "consultation",
          state: "discussing",
          consensusType: null,
          ownerParticipantId: "p1",
          createdAt: "2026-09-03T00:00:00.000Z",
          lastEventAt: "2026-09-03T00:00:00.000Z",
          activeWorkClaimants: [],
        },
      ],
    });
    meMock.mockResolvedValue({
      participant: { id: "p1", kind: "human", displayName: "ハル" },
      projectId: "proj-1",
    });

    renderPage();
    expect(await screen.findByText("あいう")).toBeInTheDocument();

    const titles = () =>
      screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent);

    expect(titles()).toEqual(["あいう", "かきく"]);

    await user.selectOptions(screen.getByLabelText("表示順"), "created_at");
    expect(titles()).toEqual(["かきく", "あいう"]);

    await user.selectOptions(screen.getByLabelText("表示順"), "title");
    expect(titles()).toEqual(["あいう", "かきく"]);
  });
});

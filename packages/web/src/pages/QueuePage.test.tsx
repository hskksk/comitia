import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueuePage } from "./QueuePage.js";

vi.mock("../api.js", () => ({
  boardClient: {
    queue: vi.fn().mockResolvedValue({
      items: [
        {
          threadId: "t1",
          title: "ルール改正",
          type: "proposal",
          state: "awaiting_decision",
          consensusType: "human_ratification",
          humanRequired: false,
          enteredAt: "2026-08-16T00:00:00.000Z",
          activeWorkClaimants: ["ハル"],
          synthesis: {
            id: "s1",
            body: "決めるのは区分の是非",
            createdAt: "2026-08-16T00:00:00.000Z",
          },
          candidateProposal: {
            id: "v1",
            versionNumber: 1,
            content: "区分を導入する",
          },
        },
        {
          threadId: "t2",
          title: "実装方針",
          type: "implementation",
          state: "awaiting_decision",
          consensusType: "owner_decision",
          humanRequired: false,
          enteredAt: "2026-08-16T01:00:00.000Z",
          synthesis: null,
          candidateProposal: null,
          activeWorkClaimants: [],
        },
      ],
    }),
  },
}));

describe("QueuePage", () => {
  afterEach(cleanup);

  it("renders queue items with Japanese labels, synthesis, and candidate proposal", async () => {
    render(
      <MemoryRouter initialEntries={["/p/proj-1/queue"]}>
        <Routes>
          <Route path="/p/:projectId/queue" element={<QueuePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("ルール改正")).toBeInTheDocument();
    expect(screen.getByText("着手中: ハル")).toBeInTheDocument();
    expect(screen.getByText("人間批准が必要です")).toBeInTheDocument();
    expect(screen.getByText("提案")).toBeInTheDocument();
    expect(screen.getAllByText("判断待ち").length).toBeGreaterThan(0);
    expect(screen.getByText("人間による批准")).toBeInTheDocument();
    expect(screen.getByText("決めるのは区分の是非")).toBeInTheDocument();
    expect(screen.getByText("候補提案 v1")).toBeInTheDocument();
    expect(screen.getByText("区分を導入する")).toBeInTheDocument();
  });

  it("moves selection with j/k and opens with Enter", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/p/proj-1/queue"]}>
        <Routes>
          <Route path="/p/:projectId/queue" element={<QueuePage />} />
          <Route
            path="/p/:projectId/threads/:id"
            element={<p>opened-thread</p>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("ルール改正")).toBeInTheDocument();
    const first = screen.getByRole("link", { name: /ルール改正/ });
    expect(first).toHaveClass("is-selected");

    await user.keyboard("j");
    const second = screen.getByRole("link", { name: /実装方針/ });
    expect(second).toHaveClass("is-selected");

    await user.keyboard("{Enter}");
    expect(await screen.findByText("opened-thread")).toBeInTheDocument();
  });
});

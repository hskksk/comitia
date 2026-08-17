import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewThreadPage } from "./NewThreadPage.js";

const searchThreadsMock = vi.fn().mockResolvedValue({ items: [] });
const searchDecisionsMock = vi.fn().mockResolvedValue({ items: [] });
const createThreadMock = vi.fn().mockResolvedValue({ id: "t-new", state: "discussing" });

vi.mock("../api.js", () => ({
  boardClient: {
    searchThreads: (...args: unknown[]) => searchThreadsMock(...args),
    searchDecisions: (...args: unknown[]) => searchDecisionsMock(...args),
    createThread: (...args: unknown[]) => createThreadMock(...args),
  },
}));

describe("NewThreadPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    searchThreadsMock.mockClear();
    searchDecisionsMock.mockClear();
    createThreadMock.mockClear();
  });

  it("searches then creates a proposal thread", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/threads/new"]}>
        <Routes>
          <Route path="/threads/new" element={<NewThreadPage />} />
          <Route path="/threads/:id" element={<p>created</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "スレッドを立てる" })).toBeDisabled();
    await user.type(screen.getByLabelText("重複検索"), "区分 ルール");
    await user.click(screen.getByRole("button", { name: "重複を検索" }));
    expect(searchThreadsMock).toHaveBeenCalledWith("区分 ルール");
    await user.type(screen.getByLabelText("タイトル"), "区分を導入する");
    await user.type(screen.getByLabelText("きっかけ"), "憲法層の矛盾");
    await user.click(screen.getByRole("button", { name: "スレッドを立てる" }));
    expect(createThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "区分を導入する",
        type: "proposal",
        trigger: "憲法層の矛盾",
        duplicateSearchQuery: "区分 ルール",
        consensusType: "human_ratification",
      }),
    );
    expect(await screen.findByText("created")).toBeInTheDocument();
  });
});

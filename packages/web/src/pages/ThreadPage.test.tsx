import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ThreadPage } from "./ThreadPage.js";

const declareMock = vi.fn().mockResolvedValue({ thread: { state: "decided" } });

vi.mock("../api.js", () => ({
  boardClient: {
    thread: vi.fn().mockResolvedValue({
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
    }),
    declare: (...args: unknown[]) => declareMock(...args),
  },
}));

describe("ThreadPage", () => {
  it("ratifies with summary", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/threads/t1"]}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findAllByText("争点は遡及")).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("要約"), "批准する");
    await user.click(screen.getByRole("button", { name: "批准する" }));
    expect(declareMock).toHaveBeenCalledWith("t1", {
      kind: "ratify",
      binding: true,
      summary: "批准する",
    });
  });
});

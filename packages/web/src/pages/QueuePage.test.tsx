import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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
      ],
    }),
  },
}));

describe("QueuePage", () => {
  it("renders queue items with Japanese labels, synthesis, and candidate proposal", async () => {
    render(
      <MemoryRouter>
        <QueuePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ルール改正")).toBeInTheDocument();
    expect(
      screen.getByText("提案 · 判断待ち · 人間による批准"),
    ).toBeInTheDocument();
    expect(screen.getByText("決めるのは区分の是非")).toBeInTheDocument();
    expect(screen.getByText("候補提案 v1")).toBeInTheDocument();
    expect(screen.getByText("区分を導入する")).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.js";

const getProjectMock = vi.fn().mockResolvedValue({
  id: "proj-1",
  name: "comitia",
  repoUrl: null,
  githubOwner: null,
  githubRepo: null,
  githubInstallationId: null,
  ownerParticipantId: "p1",
  threadCounts: {
    discussing: 1,
    awaiting_decision: 2,
    decided: 0,
    rejected: 3,
    completed: 0,
  },
  queueCount: 2,
  inboxCount: 1,
  queuePreview: [
    {
      threadId: "t1",
      title: "ルール改正",
      consensusType: "human_ratification",
      enteredAt: "2026-08-16T00:00:00.000Z",
    },
  ],
  participantStats: {
    humans: 1,
    agentsConnected: 1,
    agentsDisconnected: 0,
  },
  setup: { projectRule: true, threadTemplate: true },
  activeProjectRule: {
    threadId: "rule-thread-1",
    summary: "プロジェクトルール",
    content: "# プロジェクトルール\n\n- 小さな作業はオーナー決定",
  },
});

vi.mock("../api.js", () => ({
  boardClient: {
    getProject: (...args: unknown[]) => getProjectMock(...args),
    events: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

describe("DashboardPage", () => {
  afterEach(cleanup);

  it("renders queue count", async () => {
    render(
      <MemoryRouter initialEntries={["/p/proj-1"]}>
        <Routes>
          <Route path="/p/:projectId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("判断キュー")).toBeInTheDocument();
    expect(screen.getByText("2 件")).toBeInTheDocument();
    expect(screen.getByText("ルール改正")).toBeInTheDocument();
    expect(screen.getByText("不採用 3")).toBeInTheDocument();
    expect(screen.getByText("エージェント接続中 1")).toBeInTheDocument();
    expect(document.getElementById("project-rules-heading")).toBeInTheDocument();
    expect(screen.getByText("小さな作業はオーナー決定")).toBeInTheDocument();
  });

  it("collapses long project rules to five lines until expanded", async () => {
    getProjectMock.mockResolvedValueOnce({
      id: "proj-1",
      name: "comitia",
      repoUrl: null,
      githubOwner: null,
      githubRepo: null,
      githubInstallationId: null,
      ownerParticipantId: "p1",
      threadCounts: {
        discussing: 0,
        awaiting_decision: 0,
        decided: 0,
        rejected: 0,
        completed: 0,
      },
      queueCount: 0,
      inboxCount: 0,
      queuePreview: [],
      setup: { projectRule: true, threadTemplate: true },
      activeProjectRule: {
        threadId: "rule-thread-1",
        summary: "プロジェクトルール",
        content: ["alpha", "", "beta", "", "gamma", "", "delta", "", "epsilon", "", "zeta"].join(
          "\n",
        ),
      },
    });

    render(
      <MemoryRouter initialEntries={["/p/proj-1"]}>
        <Routes>
          <Route path="/p/:projectId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("zeta")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "続き" }));
    expect(screen.getByText("zeta")).toBeInTheDocument();
  });
});

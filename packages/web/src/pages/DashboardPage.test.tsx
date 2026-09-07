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

const activityMock = vi.fn().mockResolvedValue({ items: [] });

vi.mock("../api.js", () => ({
  boardClient: {
    getProject: (...args: unknown[]) => getProjectMock(...args),
    activity: (...args: unknown[]) => activityMock(...args),
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

  it("renders human-readable agent, GitHub, and interruption activities", async () => {
    activityMock.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          kind: "post_added",
          actor: {
            id: "agent-1",
            displayName: "ミカ@ハル",
            kind: "agent",
          },
          subject: {
            type: "thread",
            id: "thread-1",
            title: "認証方式を決める",
            href: "/p/proj-1/threads/thread-1",
          },
          detail: {
            type: "post",
            postId: "post-1",
            postType: "objection",
            preview: "鍵の更新手順が決まっていません",
          },
          createdAt: "2026-08-16T00:00:00.000Z",
        },
        {
          id: 2,
          kind: "pull_request_synced",
          actor: null,
          subject: {
            type: "thread",
            id: "thread-2",
            title: "検索 API を実装",
            href: "/p/proj-1/threads/thread-2",
          },
          detail: {
            type: "pullRequest",
            number: 142,
            title: "Add project activity endpoint",
            state: "merged",
            fromState: "open",
            externalUrl: "https://github.com/hskksk/comitia/pull/142",
          },
          createdAt: "2026-08-16T00:00:00.000Z",
        },
        {
          id: 3,
          kind: "session_interrupted",
          actor: null,
          subject: {
            type: "project",
            id: "proj-1",
            name: "comitia",
            href: "/p/proj-1/participants",
          },
          detail: {
            type: "session",
            sessionId: "session-1",
            participantId: "agent-1",
            displayName: "ミカ@ハル",
          },
          createdAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/p/proj-1"]}>
        <Routes>
          <Route path="/p/:projectId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const threadLink = await screen.findByRole("link", {
      name: "認証方式を決める",
    });
    expect(threadLink.closest("li")).toHaveTextContent(
      "ミカ@ハルが「認証方式を決める」に異議を投稿",
    );
    expect(screen.getByText("鍵の更新手順が決まっていません")).toBeInTheDocument();
    expect(threadLink).toHaveAttribute("href", "/p/proj-1/threads/thread-1");
    const pullRequestLink = screen.getByRole("link", {
      name: "Add project activity endpoint",
    });
    expect(pullRequestLink.closest("li")).toHaveTextContent(
      "GitHubで「検索 API を実装」のPR #142がマージ済みに更新",
    );
    expect(pullRequestLink).toHaveAttribute(
      "href",
      "https://github.com/hskksk/comitia/pull/142",
    );
    const interrupted = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("一日が"));
    expect(interrupted).toHaveTextContent(
      "ミカ@ハルの一日が「comitia」で中断",
    );
    expect(interrupted).not.toHaveTextContent("ミカ@ハルが");
  });

  it("keeps an empty activity section visible", async () => {
    render(
      <MemoryRouter initialEntries={["/p/proj-1"]}>
        <Routes>
          <Route path="/p/:projectId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("最近の活動")).toBeInTheDocument();
    expect(screen.getByText("まだ活動はありません")).toBeInTheDocument();
  });

  it("shows an activity-only error and retries without hiding the dashboard", async () => {
    activityMock
      .mockRejectedValueOnce(new Error("activity unavailable"))
      .mockResolvedValueOnce({ items: [] });
    render(
      <MemoryRouter initialEntries={["/p/proj-1"]}>
        <Routes>
          <Route path="/p/:projectId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("判断キュー")).toBeInTheDocument();
    expect(
      await screen.findByText(/activity unavailable/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再取得" }));
    expect(await screen.findByText("まだ活動はありません")).toBeInTheDocument();
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

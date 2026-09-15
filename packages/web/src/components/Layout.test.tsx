import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout.js";

vi.mock("../api.js", () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn().mockReturnValue(null),
  boardClient: {
    me: vi.fn().mockResolvedValue({
      participant: { id: "p1", kind: "human", displayName: "ハル" },
      projectId: "proj-1",
      projects: [
        {
          id: "proj-1",
          name: "comitia",
          ownerParticipantId: "p1",
          repoUrl: null,
        },
        {
          id: "proj-2",
          name: "実験",
          ownerParticipantId: "p1",
          repoUrl: null,
        },
      ],
    }),
  },
}));

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/settings" element={<p>user-settings</p>} />
          <Route path="/projects" element={<p>projects-home</p>} />
          <Route path="/p/:projectId" element={<p>dashboard</p>} />
          <Route path="/p/:projectId/queue" element={<p>queue-page</p>} />
          <Route path="/p/:projectId/settings" element={<p>project-settings</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  afterEach(cleanup);

  it("includes dashboard link in sidebar", async () => {
    renderShell("/p/proj-1");
    const sidebarNav = await screen.findByRole("navigation", { name: "メイン" });
    expect(within(sidebarNav).getByRole("link", { name: "ダッシュボード" })).toHaveAttribute(
      "href",
      "/p/proj-1",
    );
  });

  it("shows a page nav in the top bar with the same destinations", async () => {
    renderShell("/p/proj-1");
    expect(screen.getByRole("banner")).toHaveClass("top-bar");
    const pageNav = await screen.findByRole("navigation", { name: "ページ" });
    expect(pageNav).toHaveClass("nav");
    expect(within(pageNav).getByRole("link", { name: "ダッシュボード" })).toHaveAttribute(
      "href",
      "/p/proj-1",
    );
    expect(within(pageNav).getByRole("link", { name: "判断キュー" })).toHaveAttribute(
      "href",
      "/p/proj-1/queue",
    );
  });

  it("navigates from the top page nav", async () => {
    const user = userEvent.setup();
    renderShell("/p/proj-1");
    await screen.findByText("dashboard");
    const pageNav = screen.getByRole("navigation", { name: "ページ" });
    await user.click(within(pageNav).getByRole("link", { name: "判断キュー" }));
    expect(await screen.findByText("queue-page")).toBeInTheDocument();
  });

  it("goes to the new project's dashboard when switching from user settings", async () => {
    const user = userEvent.setup();
    renderShell("/settings");
    await screen.findByText("user-settings");
    await screen.findByRole("option", { name: "実験" });
    await user.selectOptions(screen.getByLabelText("プロジェクト"), "proj-2");
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(screen.queryByText("project-settings")).not.toBeInTheDocument();
  });

  it("keeps the queue path when switching projects", async () => {
    const user = userEvent.setup();
    renderShell("/p/proj-1/queue");
    await screen.findByText("queue-page");
    await screen.findByRole("option", { name: "実験" });
    await user.selectOptions(screen.getByLabelText("プロジェクト"), "proj-2");
    expect(await screen.findByText("queue-page")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("proj-2");
  });
});

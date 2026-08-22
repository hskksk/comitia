import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsPage } from "./ProjectSettingsPage.js";

const getProjectMock = vi.fn();
const meMock = vi.fn();
const listMembersMock = vi.fn();
const connectGitHubAppMock = vi.fn();

vi.mock("../api.js", () => ({
  boardClient: {
    me: (...args: unknown[]) => meMock(...args),
    getProject: (...args: unknown[]) => getProjectMock(...args),
    listMembers: (...args: unknown[]) => listMembersMock(...args),
    connectGitHubApp: (...args: unknown[]) => connectGitHubAppMock(...args),
  },
}));

const projectBase = {
  id: "proj-1",
  name: "comitia",
  repoUrl: "https://github.com/hskksk/comitia",
  githubOwner: "hskksk",
  githubRepo: "comitia",
  githubInstallationId: null as string | null,
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
  setup: { projectRule: false, threadTemplate: false },
  activeProjectRule: null,
};

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={["/p/proj-1/settings"]}>
      <Routes>
        <Route path="/p/:projectId/settings" element={<ProjectSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectSettingsPage", () => {
  afterEach(() => {
    cleanup();
    getProjectMock.mockReset();
    meMock.mockReset();
    listMembersMock.mockReset();
    connectGitHubAppMock.mockReset();
  });

  it("offers install when the project has no GitHub App connection", async () => {
    meMock.mockResolvedValue({
      participant: { id: "p1", kind: "human", displayName: "ハル" },
      projectId: "proj-1",
    });
    getProjectMock.mockResolvedValue({
      ...projectBase,
      githubInstallationId: null,
    });
    listMembersMock.mockResolvedValue({
      items: [{ id: "p1", kind: "human", displayName: "ハル", engine: null, ownerParticipantId: null, roles: [] }],
    });

    renderSettings();

    expect(
      await screen.findByRole("button", { name: "GitHub App を接続" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("未接続");
    expect(screen.queryByText("接続済み")).not.toBeInTheDocument();
  });

  it("shows connected status instead of install when already linked", async () => {
    meMock.mockResolvedValue({
      participant: { id: "p1", kind: "human", displayName: "ハル" },
      projectId: "proj-1",
    });
    getProjectMock.mockResolvedValue({
      ...projectBase,
      githubInstallationId: "inst-1",
    });
    listMembersMock.mockResolvedValue({
      items: [{ id: "p1", kind: "human", displayName: "ハル", engine: null, ownerParticipantId: null, roles: [] }],
    });

    renderSettings();

    expect(await screen.findByRole("status")).toHaveTextContent("接続済み");
    expect(screen.getByText("hskksk/comitia")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "再接続する" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "GitHub App を接続" }),
    ).not.toBeInTheDocument();
  });

  it("connects an existing GitHub App installation without leaving the page", async () => {
    const user = userEvent.setup();
    const member = {
      id: "p1",
      kind: "human" as const,
      displayName: "ハル",
      engine: null,
      ownerParticipantId: null,
      roles: [],
    };
    meMock.mockResolvedValue({
      participant: { id: "p1", kind: "human", displayName: "ハル" },
      projectId: "proj-1",
    });
    getProjectMock
      .mockResolvedValueOnce({
        ...projectBase,
        githubInstallationId: null,
      })
      .mockResolvedValueOnce({
        ...projectBase,
        githubInstallationId: "inst-42",
      });
    listMembersMock.mockResolvedValue({ items: [member] });
    connectGitHubAppMock.mockResolvedValue({ connected: true });

    renderSettings();
    await user.click(
      await screen.findByRole("button", { name: "GitHub App を接続" }),
    );

    expect(connectGitHubAppMock).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("接続済み");
  });
});

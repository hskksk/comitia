import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";

const createAgentMock = vi.fn().mockResolvedValue({
  agent: { id: "a1", displayName: "ウォーカー", engine: "fake" },
  agentToken: "comt_once",
});
const listOwnedAgentsMock = vi.fn().mockResolvedValue({ items: [] });
const listIdentityCredentialsMock = vi.fn().mockResolvedValue({ items: [] });

vi.mock("../api.js", () => ({
  boardClient: {
    me: vi.fn().mockResolvedValue({
      participant: {
        id: "p1",
        kind: "human",
        displayName: "ハル",
        githubLogin: null,
      },
      projectId: "proj-1",
      projects: [
        {
          id: "proj-1",
          name: "comitia",
          ownerParticipantId: "p1",
          repoUrl: null,
        },
      ],
    }),
    listProjects: vi.fn().mockResolvedValue({
      items: [
        {
          id: "proj-1",
          name: "comitia",
          ownerParticipantId: "p1",
          repoUrl: null,
        },
      ],
    }),
    listOwnedAgents: (...args: unknown[]) => listOwnedAgentsMock(...args),
    listIdentityCredentials: (...args: unknown[]) =>
      listIdentityCredentialsMock(...args),
    createAgent: (...args: unknown[]) => createAgentMock(...args),
  },
}));

describe("SettingsPage", () => {
  afterEach(() => {
    cleanup();
    createAgentMock.mockClear();
    listOwnedAgentsMock.mockClear();
    listOwnedAgentsMock.mockResolvedValue({ items: [] });
    listIdentityCredentialsMock.mockClear();
    listIdentityCredentialsMock.mockResolvedValue({ items: [] });
  });

  it("creates an agent and shows the token once", async () => {
    const user = userEvent.setup();
    listOwnedAgentsMock
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          {
            id: "a1",
            displayName: "ウォーカー",
            engine: "fake",
            ownerParticipantId: "p1",
          },
        ],
      });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText("名前"), "ウォーカー");
    await user.selectOptions(screen.getByLabelText("エンジン"), "fake");
    await user.click(screen.getByRole("button", { name: "登録する" }));
    expect(createAgentMock).toHaveBeenCalledWith({
      displayName: "ウォーカー",
      engine: "fake",
      projectId: "proj-1",
      role: undefined,
    });
    expect(await screen.findByText("トークン（一度だけ表示）")).toBeInTheDocument();
    expect(screen.getByText("comt_once")).toBeInTheDocument();
    expect(await screen.findByText("ウォーカー")).toBeInTheDocument();
  });
});

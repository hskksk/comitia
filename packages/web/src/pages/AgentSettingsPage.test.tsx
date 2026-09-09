import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONALITY_PRESETS } from "@comitia/shared/constants";
import { AgentSettingsPage } from "./AgentSettingsPage.js";

const listOwnedAgentsMock = vi.fn();
const updateOwnedAgentMock = vi.fn();

vi.mock("../api.js", () => ({
  boardClient: {
    listOwnedAgents: (...args: unknown[]) => listOwnedAgentsMock(...args),
    updateOwnedAgent: (...args: unknown[]) => updateOwnedAgentMock(...args),
  },
}));

function renderPage(agentId: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings/agents/${agentId}`]}>
      <Routes>
        <Route path="/settings" element={<p>ユーザー設定</p>} />
        <Route
          path="/settings/agents/:agentId"
          element={<AgentSettingsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentSettingsPage", () => {
  afterEach(() => {
    cleanup();
    listOwnedAgentsMock.mockReset();
    updateOwnedAgentMock.mockReset();
  });

  it("shows and saves display name, engine, and personality", async () => {
    const user = userEvent.setup();
    const cautious = PERSONALITY_PRESETS.find((preset) => preset.id === "慎重");
    listOwnedAgentsMock.mockResolvedValue({
      items: [
        {
          id: "a1",
          displayName: "ウォーカー",
          engine: "fake",
          personality: "独自の態度",
          ownerParticipantId: "p1",
        },
      ],
    });
    updateOwnedAgentMock.mockResolvedValue({
      id: "a1",
      displayName: "ウォーカー改",
      engine: "claude-code",
      personality: cautious?.body ?? null,
    });
    renderPage("a1");
    expect(await screen.findByDisplayValue("ウォーカー")).toBeInTheDocument();
    expect(screen.getByText(/agentId:/)).toBeInTheDocument();
    expect(screen.getByText("a1")).toBeInTheDocument();
    expect(screen.getByLabelText("エンジン")).toHaveValue("fake");
    expect(screen.getByLabelText("性格（任意）")).toHaveValue("独自の態度");
    expect(screen.getByText(cautious?.body ?? "")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("表示名"));
    await user.type(screen.getByLabelText("表示名"), "ウォーカー改");
    await user.selectOptions(screen.getByLabelText("エンジン"), "claude-code");
    await user.click(screen.getByRole("button", { name: "慎重の文を入れる" }));
    await user.click(screen.getByRole("button", { name: "保存する" }));
    expect(updateOwnedAgentMock).toHaveBeenCalledWith("a1", {
      displayName: "ウォーカー改",
      engine: "claude-code",
      personality: cautious?.body,
    });
  });

  it("clears personality when saved empty", async () => {
    const user = userEvent.setup();
    listOwnedAgentsMock.mockResolvedValue({
      items: [
        {
          id: "a1",
          displayName: "ウォーカー",
          engine: "fake",
          personality: "独自の態度",
          ownerParticipantId: "p1",
        },
      ],
    });
    updateOwnedAgentMock.mockResolvedValue({
      id: "a1",
      displayName: "ウォーカー",
      engine: "fake",
      personality: null,
    });
    renderPage("a1");
    await screen.findByDisplayValue("ウォーカー");
    await user.clear(screen.getByLabelText("性格（任意）"));
    await user.click(screen.getByRole("button", { name: "保存する" }));
    expect(updateOwnedAgentMock).toHaveBeenCalledWith("a1", {
      displayName: "ウォーカー",
      engine: "fake",
      personality: null,
    });
  });

  it("redirects unknown agents to user settings", async () => {
    listOwnedAgentsMock.mockResolvedValue({
      items: [
        {
          id: "a1",
          displayName: "ウォーカー",
          engine: "fake",
          personality: null,
          ownerParticipantId: "p1",
        },
      ],
    });
    renderPage("someone-else");
    expect(await screen.findByText("ユーザー設定")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "エージェント設定" })).not.toBeInTheDocument();
  });
});

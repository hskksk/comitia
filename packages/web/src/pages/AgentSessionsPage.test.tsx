import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionsPage } from "./AgentSessionsPage.js";

const agentSessionsMock = vi.fn();

vi.mock("../api.js", () => ({
  boardClient: {
    agentSessions: (...args: unknown[]) => agentSessionsMock(...args),
  },
}));

describe("AgentSessionsPage", () => {
  afterEach(() => {
    cleanup();
    agentSessionsMock.mockReset();
  });

  it("labels the first goal so it is not mistaken for the chat log", async () => {
    agentSessionsMock.mockResolvedValue({
      items: [
        {
          id: "sess-1",
          participantId: "agent-1",
          displayName: "ミカ@ハル",
          startedAt: "2026-08-31T11:00:00.000Z",
          endedAt: "2026-08-31T12:00:00.000Z",
          endedReason: "completed",
          remainingBudget: 12,
          budgetLimit: 1000,
          budgetUsed: 988,
          goals: [{ id: "g1", text: "スレッドを読む", status: "completed" }],
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/p/proj/participants/agent-1"]}>
        <Routes>
          <Route
            path="/p/:projectId/participants/:id"
            element={<AgentSessionsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("ログを読む")).toBeInTheDocument();
    expect(screen.getByText("目標:")).toBeInTheDocument();
    expect(screen.getByText("スレッドを読む")).toBeInTheDocument();
  });
});

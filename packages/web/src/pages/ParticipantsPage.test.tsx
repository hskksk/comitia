import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantsPage } from "./ParticipantsPage.js";

const participantsMock = vi.fn().mockResolvedValue({
  items: [
    {
      id: "owner-1",
      kind: "human",
      displayName: "ハル",
      engine: null,
      ownerParticipantId: null,
      roles: [],
      connection: null,
      openSession: null,
    },
    {
      id: "agent-1",
      kind: "agent",
      displayName: "ミカ",
      engine: "claude-code",
      ownerParticipantId: "owner-1",
      roles: ["facilitator"],
      connection: { status: "disconnected", lastSeenAt: null },
      openSession: null,
    },
  ],
});
const wakeMock = vi.fn().mockResolvedValue({ tickId: "tick-1", status: "queued" });

vi.mock("../api.js", () => ({
  boardClient: {
    participants: (...args: unknown[]) => participantsMock(...args),
    wakeAgent: (...args: unknown[]) => wakeMock(...args),
  },
}));

describe("ParticipantsPage", () => {
  afterEach(cleanup);

  it("shows connection status and wakes an agent", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ParticipantsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("ミカ")).toBeInTheDocument();
    expect(screen.getByText(/claude-code/)).toBeInTheDocument();
    expect(screen.getByText("切断")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログ" })).toHaveAttribute(
      "href",
      "/participants/agent-1",
    );
    await user.click(screen.getByRole("button", { name: "起こす" }));
    expect(wakeMock).toHaveBeenCalledWith("agent-1");
  });
});

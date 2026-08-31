import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantsPage } from "./ParticipantsPage.js";

const participantsMock = vi.fn().mockResolvedValue({
  items: [
    {
      id: "owner-1",
      kind: "human",
      displayName: "ハル",
      label: "ハル",
      engine: null,
      ownerParticipantId: null,
      roles: [],
      connection: null,
      openSession: null,
      wake: null,
    },
    {
      id: "agent-1",
      kind: "agent",
      displayName: "ミカ",
      label: "ミカ@ハル",
      engine: "claude-code",
      personality: "対立する案を残す",
      ownerParticipantId: "owner-1",
      roles: ["facilitator"],
      connection: { status: "disconnected", lastSeenAt: null },
      openSession: null,
      wake: "idle",
    },
  ],
});
const wakeMock = vi.fn().mockResolvedValue({ tickId: "tick-1", status: "queued" });
const meMock = vi.fn().mockResolvedValue({
  participant: { id: "owner-1", kind: "human", displayName: "ハル" },
  projectId: "proj",
});

vi.mock("../api.js", () => ({
  boardClient: {
    participants: (...args: unknown[]) => participantsMock(...args),
    wakeAgent: (...args: unknown[]) => wakeMock(...args),
    me: (...args: unknown[]) => meMock(...args),
  },
}));

describe("ParticipantsPage", () => {
  afterEach(cleanup);

  it("shows connection status and wakes an agent", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/p/proj-1/participants"]}>
        <Routes>
          <Route path="/p/:projectId/participants" element={<ParticipantsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("ミカ@ハル")).toBeInTheDocument();
    expect(screen.getByText(/claude-code/)).toBeInTheDocument();
    expect(screen.getByText("態度: 対立する案を残す")).toBeInTheDocument();
    expect(screen.getByText("切断")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログ" })).toHaveAttribute(
      "href",
      "/p/proj-1/participants/agent-1",
    );
    await user.click(screen.getByRole("button", { name: "起こす" }));
    expect(wakeMock).toHaveBeenCalledWith("agent-1");
  });

  it("shows the wake badge without dropping the connection badge or remaining line", async () => {
    participantsMock.mockResolvedValueOnce({
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
          wake: null,
        },
        {
          id: "agent-1",
          kind: "agent",
          displayName: "ミカ",
          engine: "claude-code",
          ownerParticipantId: "owner-1",
          roles: ["facilitator"],
          connection: { status: "connected", lastSeenAt: null },
          openSession: { id: "s1", remainingBudget: 500, firstGoal: null, startedAt: "2026-08-16T00:00:00.000Z" },
          wake: "undigested",
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/p/proj/participants"]}>
        <Routes>
          <Route path="/p/:projectId/participants" element={<ParticipantsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("ミカ");
    expect(screen.getByText("接続中")).toBeInTheDocument();
    expect(screen.getByText(/残量 500/)).toBeInTheDocument();
    expect(screen.getByText("起床待ち（未消化）")).toBeInTheDocument();
  });

  it("shows a notes link only on the current user's own card", async () => {
    render(
      <MemoryRouter initialEntries={["/p/proj/participants"]}>
        <Routes>
          <Route path="/p/:projectId/participants" element={<ParticipantsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("ミカ@ハル");
    const links = await screen.findAllByRole("link", { name: "自分のメモ" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/p/proj/notes");
  });
});

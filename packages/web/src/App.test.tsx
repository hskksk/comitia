import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setToken } from "./auth.js";
import { App } from "./App.js";

const meMock = vi.fn().mockResolvedValue({
  participant: { id: "p1", kind: "human", displayName: "ハル" },
  projectId: "proj-1",
  projects: [{ id: "proj-1", name: "comitia", ownerParticipantId: "p1", repoUrl: null }],
});

vi.mock("./api.js", () => ({
  UNAUTHORIZED_EVENT: "comitia:unauthorized",
  setCurrentProjectId: vi.fn(),
  boardClient: {
    me: (...args: unknown[]) => meMock(...args),
    queue: vi.fn().mockResolvedValue({ items: [] }),
    authConfig: vi.fn().mockResolvedValue({ githubOAuth: false }),
    getProject: vi.fn().mockResolvedValue({
      id: "proj-1",
      name: "comitia",
      repoUrl: null,
      queueCount: 0,
      inboxCount: 0,
      threadCounts: {
        discussing: 0,
        awaiting_decision: 0,
        decided: 0,
        rejected: 0,
        completed: 0,
      },
      queuePreview: [],
    }),
    events: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it("redirects to login when no token is stored", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("トークンで入る")).toBeInTheDocument();
  });

  it("redirects to login after an unauthorized request", async () => {
    setToken("expired-token");
    render(
      <MemoryRouter initialEntries={["/p/proj-1"]}>
        <App />
      </MemoryRouter>,
    );

    window.dispatchEvent(new Event("comitia:unauthorized"));

    expect(await screen.findByText("トークンで入る")).toBeInTheDocument();
  });
});

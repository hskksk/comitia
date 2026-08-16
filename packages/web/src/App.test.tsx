import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setToken } from "./auth.js";
import { App } from "./App.js";

vi.mock("./api.js", () => ({
  UNAUTHORIZED_EVENT: "comitia:unauthorized",
  boardClient: {
    queue: vi.fn().mockResolvedValue({ items: [] }),
    authConfig: vi.fn().mockResolvedValue({ githubOAuth: false }),
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
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    window.dispatchEvent(new Event("comitia:unauthorized"));

    expect(await screen.findByText("トークンで入る")).toBeInTheDocument();
  });
});

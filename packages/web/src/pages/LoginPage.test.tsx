import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getToken } from "../auth.js";
import { LoginPage } from "./LoginPage.js";

const meMock = vi.fn().mockRejectedValue(new Error("unauthorized"));
const authConfigMock = vi.fn().mockResolvedValue({
  githubOAuth: false,
  previewLogin: false,
});

vi.mock("../api.js", () => ({
  boardClient: {
    me: (...args: unknown[]) => meMock(...args),
    authConfig: (...args: unknown[]) => authConfigMock(...args),
  },
}));

describe("LoginPage", () => {
  beforeEach(() => {
    authConfigMock.mockResolvedValue({
      githubOAuth: false,
      previewLogin: false,
    });
    meMock.mockRejectedValue(new Error("unauthorized"));
  });

  afterEach(() => {
    cleanup();
  });

  it("clears the stored token when login fails", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByText("トークンで入る"));
    await user.type(screen.getByLabelText("トークン"), "bad-token");
    await user.click(screen.getByRole("button", { name: "入る" }));

    await screen.findByText(/トークンが無効です/);
    expect(getToken()).toBeNull();
  });

  it("shows GitHub login when OAuth is enabled", async () => {
    authConfigMock.mockResolvedValue({
      githubOAuth: true,
      previewLogin: false,
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: "GitHub で入る" });
    expect(link).toHaveAttribute(
      "href",
      `/v1/auth/github?return_origin=${encodeURIComponent(window.location.origin)}`,
    );
  });

  it("shows preview enter and hides GitHub OAuth and token form", async () => {
    authConfigMock.mockResolvedValue({
      githubOAuth: true,
      previewLogin: true,
    });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link", { name: "プレビューに入る" });
    expect(link).toHaveAttribute("href", "/v1/auth/preview-enter");
    expect(screen.queryByRole("link", { name: "GitHub で入る" })).not.toBeInTheDocument();
    expect(screen.queryByText("トークンで入る")).not.toBeInTheDocument();
  });
});

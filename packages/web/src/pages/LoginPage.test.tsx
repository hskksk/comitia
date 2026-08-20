import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { getToken } from "../auth.js";
import { LoginPage } from "./LoginPage.js";

const meMock = vi.fn().mockRejectedValue(new Error("unauthorized"));
const authConfigMock = vi.fn().mockResolvedValue({ githubOAuth: false });

vi.mock("../api.js", () => ({
  boardClient: {
    me: (...args: unknown[]) => meMock(...args),
    authConfig: (...args: unknown[]) => authConfigMock(...args),
  },
}));

describe("LoginPage", () => {
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
    authConfigMock.mockResolvedValueOnce({ githubOAuth: true });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("GitHub で入る")).toBeInTheDocument();
  });
});
